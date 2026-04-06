const state = {
  projects: [],
  projectRoots: [],
  selectedProject: "",
  selectedSessionId: "",
  threadEntries: [],
  modalThread: null,
  summaryModalProject: "",
  projectSummaries: {},
  projectModalOpen: false,
  projectModalMode: "existing",
  projectModalRoot: "",
  projectModalRepoPath: "",
  projectModalName: "",
  projectModalProvider: "claude",
  projectModalStatus: "",
  historyThreads: {},
  queueCollapsed: false,
  copiedFeedback: {},
  projectsLoading: true,
  projectRootsLoading: false,
  dispatchPending: false,
  sessionSwitchPending: false,
  projectModalPending: false,
  projectsRefreshPromise: null,
  projectRootsRefreshPromise: null,
  threadRefreshPromise: null,
  controlLockTarget: "",
  controlLockUntil: 0,
};

const elements = {
  headerCarouselButton: document.querySelector("#headerCarouselButton"),
  headerCarouselImage: document.querySelector("#headerCarouselImage"),
  headerCatchphrase: document.querySelector("#headerCatchphrase"),
  projectSelect: document.querySelector("#projectSelect"),
  projectAddButton: document.querySelector("#projectAddButton"),
  sessionControl: document.querySelector(".session-control"),
  sessionSelect: document.querySelector("#sessionSelect"),
  sessionThreadButton: document.querySelector("#sessionThreadButton"),
  messageInput: document.querySelector("#messageInput"),
  dispatchForm: document.querySelector("#dispatchForm"),
  dispatchButton: document.querySelector("#dispatchButton"),
  mailboxState: document.querySelector("#mailboxState"),
  queueUnreadOrb: document.querySelector("#queueUnreadOrb"),
  queueSection: document.querySelector(".queue"),
  queueToggle: document.querySelector("#queueToggle"),
  queueBody: document.querySelector("#queueBody"),
  queueList: document.querySelector("#queueList"),
  detailModal: document.querySelector("#detailModal"),
  detailBackdrop: document.querySelector("#detailBackdrop"),
  detailClose: document.querySelector("#detailClose"),
  detailProject: document.querySelector("#detailProject"),
  detailSession: document.querySelector("#detailSession"),
  detailHistoryState: document.querySelector("#detailHistoryState"),
  detailHistoryList: document.querySelector("#detailHistoryList"),
  projectSummaryButton: document.querySelector("#projectSummaryButton"),
  projectModal: document.querySelector("#projectModal"),
  projectModalBackdrop: document.querySelector("#projectModalBackdrop"),
  projectModalClose: document.querySelector("#projectModalClose"),
  projectModalForm: document.querySelector("#projectModalForm"),
  projectModalState: document.querySelector("#projectModalState"),
  projectRootSelect: document.querySelector("#projectRootSelect"),
  projectRepoSelect: document.querySelector("#projectRepoSelect"),
  projectNameInput: document.querySelector("#projectNameInput"),
  projectProviderSelect: document.querySelector("#projectProviderSelect"),
  projectCreateButton: document.querySelector("#projectCreateButton"),
  projectModeExisting: document.querySelector("#projectModeExisting"),
  projectModeNew: document.querySelector("#projectModeNew"),
  summaryModal: document.querySelector("#summaryModal"),
  summaryBackdrop: document.querySelector("#summaryBackdrop"),
  summaryClose: document.querySelector("#summaryClose"),
  summaryProject: document.querySelector("#summaryProject"),
  summarySession: document.querySelector("#summarySession"),
  summaryState: document.querySelector("#summaryState"),
  summaryList: document.querySelector("#summaryList"),
  summaryRefreshButton: document.querySelector("#summaryRefreshButton"),
};

const autoRefreshMs = 15000;
const projectCacheKey = "clawdad-project-catalog-v4";
const threadCacheKey = "clawdad-thread-log-v1";
const queueCollapsedKey = "clawdad-queue-collapsed-v1";
const queuedDispatchGraceMs = 15000;
const copiedFeedbackMs = 1400;
const historyPageSize = 20;
const headerCarouselIntervalMs = 11000;
const headerCarouselVersion = "20260406m";
const headerCatchphraseSwapMs = 150;
const pendingSessionPhrases = [
  "loading up a fresh beaux",
  "stirrin' a new bayou lane",
  "cookin' up a clean little thread",
  "pourin' a fresh clawdad session",
  "settin' the table for a new beaux",
  "spinnin' up a new swamp-side lane",
];
const headerCatchphraseLeadIns = [
  "Pass dat",
  "Keep dat",
  "Pour dat",
  "Bring dat",
  "Stir dat",
  "Catch dat",
  "Hold dat",
  "Run dat",
  "Shake dat",
  "Wear dat",
  "Serve dat",
  "Spin dat",
  "Work dat",
  "Stack dat",
  "Light dat",
  "Crown dat",
  "Raise dat",
  "Ride dat",
  "Call dat",
  "Bless dat",
];
const headerCatchphraseCenterBits = [
  "bayou grin",
  "boil-pot swagger",
  "mudbug charm",
  "dockside shine",
  "clawdad glow",
  "porch-light pride",
  "papa roux",
  "lagniappe luck",
  "backyard brag",
  "crawfish cool",
];
const headerCatchphraseTailBits = [
  ", cher",
  " all night",
  " by the bayou",
  " for the ol' man",
  " with dat spice",
];
const defaultHeaderCarouselImages = Array.from(
  { length: 30 },
  (_value, index) => `/assets/clawdad-header-${String(index + 1).padStart(2, "0")}.jpg?v=${headerCarouselVersion}`,
);
const defaultHeaderCatchphrases = buildHeaderCatchphrases();
const headerCarousel = {
  images: [],
  index: 0,
  timerId: 0,
};
const headerCatchphrases = {
  phrases: [...defaultHeaderCatchphrases],
  order: [],
  cursor: 0,
  swapTimerId: 0,
};
const pendingSessionCycle = {
  order: [],
  cursor: 0,
};
const timeFormatter = new Intl.DateTimeFormat([], {
  hour: "numeric",
  minute: "2-digit",
});
const dateTimeFormatter = new Intl.DateTimeFormat([], {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});
const controlLockMs = 2600;

function copyIconMarkup() {
  return `
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="5.25" y="3.25" width="7.5" height="9.5" rx="1.6" stroke="currentColor" stroke-width="1.3"></rect>
      <path d="M3.25 10.25V4.9c0-.91.74-1.65 1.65-1.65h4.35" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"></path>
    </svg>
  `;
}

function markControlInteraction(target, ms = controlLockMs) {
  state.controlLockTarget = target;
  state.controlLockUntil = Date.now() + ms;
}

function clearControlInteraction(target = "") {
  if (!target || state.controlLockTarget === target) {
    state.controlLockTarget = "";
    state.controlLockUntil = 0;
  }
}

function controlInteractionLocked(target) {
  if (!target) {
    return false;
  }

  if (state.controlLockTarget === target && Date.now() < state.controlLockUntil) {
    return true;
  }

  const active = document.activeElement;
  return (
    (target === "project-select" && active === elements.projectSelect) ||
    (target === "session-select" && active === elements.sessionSelect) ||
    (target === "project-modal" &&
      [elements.projectRootSelect, elements.projectRepoSelect, elements.projectNameInput, elements.projectProviderSelect]
        .filter(Boolean)
        .includes(active))
  );
}

function checkIconMarkup() {
  return `
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3.35 8.2 6.6 11.35 12.65 4.95" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"></path>
    </svg>
  `;
}

function buildHeaderCatchphrases() {
  const phrases = [];

  for (const leadIn of headerCatchphraseLeadIns) {
    for (const centerBit of headerCatchphraseCenterBits) {
      for (const tailBit of headerCatchphraseTailBits) {
        phrases.push(`${leadIn} ${centerBit}${tailBit}`);
      }
    }
  }

  return phrases;
}

function randomInteger(maxExclusive) {
  if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
    return 0;
  }

  if (globalThis.crypto?.getRandomValues) {
    const values = new Uint32Array(1);
    globalThis.crypto.getRandomValues(values);
    return values[0] % maxExclusive;
  }

  return Math.floor(Math.random() * maxExclusive);
}

function basenameFromPath(projectPath) {
  const value = String(projectPath || "").replace(/\/+$/, "");
  if (!value) {
    return "";
  }

  const parts = value.split("/");
  return parts[parts.length - 1] || value;
}

function headerCatchphraseParts(phraseIndex) {
  if (!Number.isInteger(phraseIndex) || phraseIndex < 0) {
    return {
      leadIndex: -1,
      centerIndex: -1,
      tailIndex: -1,
    };
  }

  const tailsPerCenter = headerCatchphraseTailBits.length;
  const phrasesPerLead = headerCatchphraseCenterBits.length * tailsPerCenter;

  return {
    leadIndex: Math.floor(phraseIndex / phrasesPerLead),
    centerIndex: Math.floor(phraseIndex / tailsPerCenter) % headerCatchphraseCenterBits.length,
    tailIndex: phraseIndex % tailsPerCenter,
  };
}

function shuffleInPlace(values) {
  for (let index = values.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInteger(index + 1);
    [values[index], values[swapIndex]] = [values[swapIndex], values[index]];
  }
  return values;
}

function nextPendingSessionPhrase() {
  if (pendingSessionPhrases.length === 0) {
    return "loading up a fresh beaux";
  }

  if (
    pendingSessionCycle.order.length === 0 ||
    pendingSessionCycle.cursor >= pendingSessionCycle.order.length
  ) {
    pendingSessionCycle.order = shuffleInPlace(
      Array.from({ length: pendingSessionPhrases.length }, (_value, index) => index),
    );
    pendingSessionCycle.cursor = 0;
  }

  const phrase =
    pendingSessionPhrases[pendingSessionCycle.order[pendingSessionCycle.cursor]] ||
    pendingSessionPhrases[0];
  pendingSessionCycle.cursor += 1;
  return phrase;
}

function headerCatchphraseInTailScore(phraseIndex, previousPhraseIndex = -1) {
  if (!Number.isInteger(previousPhraseIndex) || previousPhraseIndex < 0) {
    return 3;
  }

  const currentParts = headerCatchphraseParts(phraseIndex);
  const previousParts = headerCatchphraseParts(previousPhraseIndex);

  let score = 0;
  if (currentParts.centerIndex !== previousParts.centerIndex) {
    score += 2;
  }
  if (currentParts.leadIndex !== previousParts.leadIndex) {
    score += 1;
  }
  return score;
}

function popBestPhraseFromTailBucket(bucket, previousPhraseIndex = -1) {
  if (!Array.isArray(bucket) || bucket.length === 0) {
    return -1;
  }

  let bestScore = -1;
  let bestIndexes = [];

  for (let index = 0; index < bucket.length; index += 1) {
    const candidateScore = headerCatchphraseInTailScore(bucket[index], previousPhraseIndex);
    if (candidateScore > bestScore) {
      bestScore = candidateScore;
      bestIndexes = [index];
    } else if (candidateScore === bestScore) {
      bestIndexes.push(index);
    }
  }

  const chosenBucketIndex = bestIndexes[randomInteger(bestIndexes.length)];
  const [chosenPhraseIndex] = bucket.splice(chosenBucketIndex, 1);
  return chosenPhraseIndex;
}

function shuffledHeaderCatchphraseOrder(previousLastPhraseIndex = -1) {
  const tailBuckets = Array.from({ length: headerCatchphraseTailBits.length }, () => []);

  for (let index = 0; index < headerCatchphrases.phrases.length; index += 1) {
    const { tailIndex } = headerCatchphraseParts(index);
    if (tailIndex >= 0) {
      tailBuckets[tailIndex].push(index);
    }
  }

  tailBuckets.forEach((bucket) => {
    shuffleInPlace(bucket);
  });

  const order = [];
  let previousPhraseIndex = previousLastPhraseIndex;

  while (order.length < headerCatchphrases.phrases.length) {
    const previousTailIndex = headerCatchphraseParts(previousPhraseIndex).tailIndex;
    const nonRepeatingTailIndexes = [];

    for (let tailIndex = 0; tailIndex < tailBuckets.length; tailIndex += 1) {
      if (tailBuckets[tailIndex].length > 0 && tailIndex !== previousTailIndex) {
        nonRepeatingTailIndexes.push(tailIndex);
      }
    }

    const candidateTailIndexes =
      nonRepeatingTailIndexes.length > 0
        ? nonRepeatingTailIndexes
        : tailBuckets
            .map((bucket, tailIndex) => (bucket.length > 0 ? tailIndex : -1))
            .filter((tailIndex) => tailIndex >= 0);

    if (candidateTailIndexes.length === 0) {
      break;
    }

    const largestBucketSize = candidateTailIndexes.reduce(
      (maxSize, tailIndex) => Math.max(maxSize, tailBuckets[tailIndex].length),
      0,
    );
    const balancedTailIndexes = candidateTailIndexes.filter(
      (tailIndex) => tailBuckets[tailIndex].length === largestBucketSize,
    );
    const chosenTailIndex = balancedTailIndexes[randomInteger(balancedTailIndexes.length)];
    const chosenPhraseIndex = popBestPhraseFromTailBucket(
      tailBuckets[chosenTailIndex],
      previousPhraseIndex,
    );

    if (!Number.isInteger(chosenPhraseIndex) || chosenPhraseIndex < 0) {
      break;
    }

    order.push(chosenPhraseIndex);
    previousPhraseIndex = chosenPhraseIndex;
  }

  return order;
}

function resetHeaderCatchphraseCycle(previousLastPhraseIndex = -1) {
  headerCatchphrases.order = shuffledHeaderCatchphraseOrder(previousLastPhraseIndex);
  headerCatchphrases.cursor = 0;
}

function clearHeaderCatchphraseSwap() {
  if (headerCatchphrases.swapTimerId) {
    window.clearTimeout(headerCatchphrases.swapTimerId);
    headerCatchphrases.swapTimerId = 0;
  }
}

function currentHeaderCatchphraseIndex() {
  if (
    headerCatchphrases.order.length === 0 ||
    headerCatchphrases.cursor < 0 ||
    headerCatchphrases.cursor >= headerCatchphrases.order.length
  ) {
    return -1;
  }
  return headerCatchphrases.order[headerCatchphrases.cursor];
}

function headerCatchphraseText(index = currentHeaderCatchphraseIndex()) {
  if (headerCatchphrases.phrases.length === 0) {
    return "Pass dat clawdad glow, cher";
  }
  if (!Number.isInteger(index) || index < 0) {
    return headerCatchphrases.phrases[0];
  }
  return headerCatchphrases.phrases[index % headerCatchphrases.phrases.length];
}

function advanceHeaderCatchphraseCycle() {
  if (headerCatchphrases.phrases.length === 0) {
    return;
  }

  const previousPhraseIndex = currentHeaderCatchphraseIndex();
  headerCatchphrases.cursor += 1;

  if (headerCatchphrases.cursor >= headerCatchphrases.order.length) {
    resetHeaderCatchphraseCycle(previousPhraseIndex);
  }
}

function applyHeaderCatchphrase(text, { animate = false } = {}) {
  const node = elements.headerCatchphrase;
  if (!node || !text) {
    return;
  }

  const renderedText = `"${text}"`;
  clearHeaderCatchphraseSwap();

  if (!animate || !node.textContent) {
    node.textContent = renderedText;
    node.classList.remove("is-switching");
    return;
  }

  node.classList.add("is-switching");
  headerCatchphrases.swapTimerId = window.setTimeout(() => {
    node.textContent = renderedText;
    window.requestAnimationFrame(() => {
      node.classList.remove("is-switching");
    });
    headerCatchphrases.swapTimerId = 0;
  }, headerCatchphraseSwapMs);
}

function clearHeaderCarouselTimer() {
  if (headerCarousel.timerId) {
    window.clearTimeout(headerCarousel.timerId);
    headerCarousel.timerId = 0;
  }
}

function scheduleHeaderCarouselAdvance() {
  clearHeaderCarouselTimer();
  if (headerCarousel.images.length <= 1) {
    return;
  }

  headerCarousel.timerId = window.setTimeout(() => {
    void advanceHeaderCarousel();
  }, headerCarouselIntervalMs);
}

function applyHeaderCarouselImage(src, { animate = false } = {}) {
  const image = elements.headerCarouselImage;
  if (!image || !src) {
    return;
  }

  if (animate) {
    image.classList.add("is-switching");
    window.setTimeout(() => {
      image.src = src;
      window.requestAnimationFrame(() => {
        image.classList.remove("is-switching");
      });
    }, 90);
    return;
  }

  image.src = src;
}

function updateHeaderCarouselAvailability() {
  const button = elements.headerCarouselButton;
  if (!button) {
    return;
  }

  const interactive = headerCarousel.images.length > 1;
  button.disabled = false;
  button.classList.toggle("is-static", !interactive);
  button.setAttribute(
    "aria-label",
    interactive ? "Next mascot photo" : "Mascot photo",
  );
}

async function preloadHeaderCarouselImage(src) {
  return new Promise((resolve) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(src);
    image.onerror = () => resolve("");
    image.src = src;
  });
}

function preloadHeaderCarouselWindow(startIndex = headerCarousel.index, count = 3) {
  if (headerCarousel.images.length <= 1) {
    return;
  }

  for (let offset = 1; offset <= count; offset += 1) {
    const nextIndex = (startIndex + offset) % headerCarousel.images.length;
    void preloadHeaderCarouselImage(headerCarousel.images[nextIndex]);
  }
}

async function initHeaderCarousel() {
  if (!elements.headerCarouselImage) {
    return;
  }

  headerCarousel.images = [...defaultHeaderCarouselImages];
  headerCarousel.index = 0;
  headerCatchphrases.phrases = [...defaultHeaderCatchphrases];
  resetHeaderCatchphraseCycle();
  if (headerCarousel.images[0]) {
    applyHeaderCarouselImage(headerCarousel.images[0], { animate: false });
  }
  applyHeaderCatchphrase(headerCatchphraseText(), { animate: false });
  updateHeaderCarouselAvailability();
  scheduleHeaderCarouselAdvance();
  preloadHeaderCarouselWindow(0, 4);

  let candidateImages = [];
  try {
    const payload = await fetchJson("/v1/header-carousel");
    candidateImages = Array.isArray(payload.images) ? payload.images : [];
  } catch (_error) {
    candidateImages = [];
  }

  headerCarousel.images = candidateImages.map((src) => `${src}?v=${headerCarouselVersion}`);
  headerCarousel.index = 0;

  if (headerCarousel.images.length === 0) {
    headerCarousel.images = [elements.headerCarouselImage.getAttribute("src") || ""].filter(Boolean);
  }

  if (headerCarousel.images[0]) {
    applyHeaderCarouselImage(headerCarousel.images[0], { animate: false });
  }
  applyHeaderCatchphrase(headerCatchphraseText(), { animate: false });

  updateHeaderCarouselAvailability();
  scheduleHeaderCarouselAdvance();
  preloadHeaderCarouselWindow(0, 4);
}

async function advanceHeaderCarousel() {
  if (!elements.headerCarouselImage) {
    return;
  }

  if (headerCarousel.images.length <= 1) {
    const button = elements.headerCarouselButton;
    if (button) {
      button.classList.add("is-tapped");
      window.setTimeout(() => {
        button.classList.remove("is-tapped");
      }, 220);
    }
    return;
  }

  headerCarousel.index = (headerCarousel.index + 1) % headerCarousel.images.length;
  advanceHeaderCatchphraseCycle();
  applyHeaderCarouselImage(headerCarousel.images[headerCarousel.index], { animate: true });
  applyHeaderCatchphrase(headerCatchphraseText(), { animate: true });
  preloadHeaderCarouselWindow(headerCarousel.index, 3);
  scheduleHeaderCarouselAdvance();
}

function setText(node, text, { empty = false } = {}) {
  node.textContent = text;
  node.classList.toggle("is-empty", empty);
}

function clearNode(node) {
  while (node.firstChild) {
    node.removeChild(node.firstChild);
  }
}

function appendInlineContent(node, text) {
  const value = String(text || "");
  if (!value) {
    return;
  }

  const tokenPattern = /(`[^`]+`|\*\*[^*]+?\*\*|\*[^*\n]+?\*)/g;
  let lastIndex = 0;

  for (const match of value.matchAll(tokenPattern)) {
    const token = match[0];
    const index = match.index || 0;

    if (index > lastIndex) {
      node.append(document.createTextNode(value.slice(lastIndex, index)));
    }

    if (token.startsWith("`")) {
      const code = document.createElement("code");
      code.className = "inline-code";
      code.textContent = token.slice(1, -1);
      node.append(code);
    } else if (token.startsWith("**")) {
      const strong = document.createElement("strong");
      strong.textContent = token.slice(2, -2);
      node.append(strong);
    } else if (token.startsWith("*")) {
      const emphasis = document.createElement("em");
      emphasis.textContent = token.slice(1, -1);
      node.append(emphasis);
    } else {
      node.append(document.createTextNode(token));
    }

    lastIndex = index + token.length;
  }

  if (lastIndex < value.length) {
    node.append(document.createTextNode(value.slice(lastIndex)));
  }
}

function isOrderedListLine(line) {
  return /^\d+\.\s+/.test(line);
}

function isBulletListLine(line) {
  return /^[-*•]\s+/.test(line);
}

function isListLine(line) {
  return isOrderedListLine(line) || isBulletListLine(line);
}

function listLineContent(line) {
  return line.replace(/^(\d+\.\s+|[-*•]\s+)/, "");
}

function isHeadingLine(line) {
  const trimmed = line.trim();
  if (!trimmed) {
    return false;
  }

  if (/^#{1,4}\s+/.test(trimmed)) {
    return true;
  }

  if (/^\*\*.+\*\*$/.test(trimmed) && trimmed.length <= 120) {
    return true;
  }

  if (/^[A-Z][A-Za-z0-9 /&+-]{1,40}:$/.test(trimmed)) {
    return true;
  }

  return false;
}

function headingText(line) {
  return line
    .trim()
    .replace(/^#{1,4}\s+/, "")
    .replace(/^\*\*/, "")
    .replace(/\*\*$/, "");
}

function isShortLabelLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 100) {
    return false;
  }
  return /^[A-Za-z][A-Za-z0-9 /&+-]{1,24}:\s+\S/.test(trimmed);
}

function renderParagraphLines(container, lines) {
  const paragraph = document.createElement("p");
  paragraph.className = "rich-paragraph";

  lines.forEach((line, index) => {
    if (index > 0) {
      paragraph.append(document.createElement("br"));
    }

    if (isShortLabelLine(line)) {
      const [, label = "", rest = ""] =
        line.match(/^([A-Za-z][A-Za-z0-9 /&+-]{1,24}):\s+([\s\S]+)$/) || [];
      if (label) {
        const strong = document.createElement("strong");
        strong.textContent = `${label}:`;
        paragraph.append(strong, document.createTextNode(" "));
        appendInlineContent(paragraph, rest);
        return;
      }
    }

    appendInlineContent(paragraph, line);
  });

  container.append(paragraph);
}

function renderListBlock(container, lines) {
  const ordered = isOrderedListLine(lines[0] || "");
  const list = document.createElement(ordered ? "ol" : "ul");
  list.className = "rich-list";

  let itemLines = [];

  const flushItem = () => {
    if (itemLines.length === 0) {
      return;
    }
    const item = document.createElement("li");
    item.className = "rich-list-item";
    itemLines.forEach((line, index) => {
      if (index > 0) {
        item.append(document.createElement("br"));
      }
      appendInlineContent(item, line);
    });
    list.append(item);
    itemLines = [];
  };

  for (const line of lines) {
    if (isListLine(line)) {
      flushItem();
      itemLines.push(listLineContent(line));
    } else {
      itemLines.push(line.trim());
    }
  }

  flushItem();
  container.append(list);
}

function renderCodeBlock(container, codeText) {
  const pre = document.createElement("pre");
  pre.className = "rich-code";
  const code = document.createElement("code");
  code.textContent = codeText.replace(/\n+$/, "");
  pre.append(code);
  container.append(pre);
}

function renderRichText(node, text, { emptyText = "" } = {}) {
  clearNode(node);
  const value = String(text || "").replace(/\r\n/g, "\n");

  if (!value.trim()) {
    node.textContent = emptyText;
    return;
  }

  const fragment = document.createDocumentFragment();
  const parts = value.split(/```/);

  parts.forEach((part, index) => {
    const isCode = index % 2 === 1;
    if (isCode) {
      renderCodeBlock(fragment, part.replace(/^\w+\n/, ""));
      return;
    }

    const lines = part.split("\n");
    let buffer = [];

    const flushParagraph = () => {
      if (buffer.length === 0) {
        return;
      }

      if (isListLine(buffer[0])) {
        renderListBlock(fragment, buffer);
      } else {
        renderParagraphLines(fragment, buffer);
      }
      buffer = [];
    };

    for (const rawLine of lines) {
      const line = rawLine.trimEnd();

      if (!line.trim()) {
        flushParagraph();
        continue;
      }

      if (isHeadingLine(line)) {
        flushParagraph();
        const heading = document.createElement("h4");
        heading.className = "rich-heading";
        heading.textContent = headingText(line);
        fragment.append(heading);
        continue;
      }

      if (buffer.length > 0) {
        const bufferIsList = isListLine(buffer[0]);
        const nextIsList = isListLine(line) || /^\s{2,}\S/.test(rawLine);
        if (bufferIsList && nextIsList) {
          buffer.push(line);
          continue;
        }
        if (bufferIsList && !nextIsList) {
          flushParagraph();
        }
      }

      buffer.push(line);
    }

    flushParagraph();
  });

  node.append(fragment);
}

function formatTimestamp(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  return sameDay ? timeFormatter.format(date) : dateTimeFormatter.format(date);
}

function copyFeedbackActive(copyKey) {
  return Number(state.copiedFeedback[copyKey] || 0) > Date.now();
}

function pruneCopyFeedback() {
  const now = Date.now();
  state.copiedFeedback = Object.fromEntries(
    Object.entries(state.copiedFeedback).filter(([, expiresAt]) => Number(expiresAt) > now),
  );
}

function markCopied(copyKey) {
  const expiresAt = Date.now() + copiedFeedbackMs;
  state.copiedFeedback[copyKey] = expiresAt;
  renderAll();
  window.setTimeout(() => {
    if (Number(state.copiedFeedback[copyKey] || 0) <= Date.now()) {
      delete state.copiedFeedback[copyKey];
      renderAll();
    }
  }, copiedFeedbackMs + 40);
}

async function copyText(text) {
  const value = String(text || "");
  if (!value) {
    return false;
  }

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return true;
  }

  const fallback = document.createElement("textarea");
  fallback.value = value;
  fallback.setAttribute("readonly", "true");
  fallback.style.position = "fixed";
  fallback.style.opacity = "0";
  document.body.append(fallback);
  fallback.select();

  let copied = false;
  try {
    copied = document.execCommand("copy");
  } finally {
    fallback.remove();
  }

  if (!copied) {
    throw new Error("Clipboard copy failed.");
  }

  return true;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let payload = {};

  try {
    payload = text ? JSON.parse(text) : {};
  } catch (_error) {
    payload = { ok: response.ok, error: text || response.statusText };
  }

  if (!response.ok || payload.ok === false) {
    const error = new Error(payload.error || response.statusText || "Request failed");
    error.payload = payload;
    throw error;
  }

  return payload;
}

function providerLabel(provider) {
  const value = String(provider || "").trim();
  return value || "session";
}

function sessionFingerprint(sessionId) {
  const value = String(sessionId || "").trim();
  if (!value) {
    return "unknown";
  }
  return value.length <= 8 ? value : `…${value.slice(-8)}`;
}

function sessionOptionLabel(session) {
  if (session?.pendingCreation && session?.loadingLabel) {
    return session.loadingLabel;
  }
  return `${providerLabel(session?.provider)} • ${sessionFingerprint(session?.sessionId)}`;
}

function makeEntryId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `entry-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function projectByPath(projectPath) {
  return state.projects.find((project) => project.path === projectPath) || null;
}

function currentProject() {
  return projectByPath(state.selectedProject);
}

function currentSession() {
  return currentProject()?.sessions?.find((session) => session.sessionId === state.selectedSessionId) || null;
}

function currentModalThread() {
  return state.modalThread || null;
}

function currentSummaryProject() {
  return projectByPath(state.summaryModalProject) || null;
}

function currentProjectRoot() {
  return state.projectRoots.find((root) => root.path === state.projectModalRoot) || null;
}

function currentRootRepos() {
  return Array.isArray(currentProjectRoot()?.repos) ? currentProjectRoot().repos : [];
}

function historyKey(projectPath, sessionId) {
  return `${projectPath}::${sessionId}`;
}

function historyStateFor(projectPath, sessionId) {
  return (
    state.historyThreads[historyKey(projectPath, sessionId)] || {
      items: [],
      nextCursor: "0",
      loading: false,
      initialized: false,
      error: "",
    }
  );
}

function setHistoryState(projectPath, sessionId, nextState) {
  const key = historyKey(projectPath, sessionId);
  state.historyThreads[key] = {
    ...historyStateFor(projectPath, sessionId),
    ...nextState,
  };
}

function projectSummaryStateFor(projectPath) {
  return (
    state.projectSummaries[projectPath] || {
      snapshots: [],
      latestSnapshot: null,
      loading: false,
      pending: false,
      initialized: false,
      error: "",
      summarySession: null,
    }
  );
}

function setProjectSummaryState(projectPath, nextState) {
  state.projectSummaries[projectPath] = {
    ...projectSummaryStateFor(projectPath),
    ...nextState,
  };
}

function persistQueueCollapsed() {
  try {
    localStorage.setItem(queueCollapsedKey, JSON.stringify(state.queueCollapsed));
  } catch (_error) {
    // Ignore storage failures.
  }
}

function restoreQueueCollapsed() {
  try {
    state.queueCollapsed = JSON.parse(localStorage.getItem(queueCollapsedKey) || "false") === true;
  } catch (_error) {
    state.queueCollapsed = false;
  }
}

function entryById(entryId) {
  return state.threadEntries.find((entry) => entry.id === entryId) || null;
}

function fallbackProjectLabel(projectPath) {
  const value = String(projectPath || "").trim();
  if (!value) {
    return "project";
  }
  const pieces = value.split("/").filter(Boolean);
  return pieces[pieces.length - 1] || value;
}

function sessionForEntry(entry) {
  return (
    projectByPath(entry?.projectPath)?.sessions?.find(
      (session) => session.sessionId === entry?.sessionId,
    ) || null
  );
}

function entryProjectLabel(entry) {
  return (
    entry?.projectLabel ||
    projectByPath(entry?.projectPath)?.displayName ||
    fallbackProjectLabel(entry?.projectPath)
  );
}

function entrySessionLabel(entry) {
  if (entry?.sessionLabel) {
    return entry.sessionLabel;
  }
  return sessionOptionLabel(sessionForEntry(entry));
}

function normalizeHistoryItem(item) {
  const sessionId = String(item?.sessionId || "").trim();
  const provider = String(item?.provider || "").trim() || sessionForEntry(item)?.provider || "session";
  const normalizedStatus = String(item?.status || "queued").trim() || "queued";
  const answeredAt = String(item?.answeredAt || "").trim() || null;
  return {
    requestId: String(item?.requestId || "").trim() || makeEntryId(),
    projectPath: String(item?.projectPath || "").trim(),
    sessionId,
    projectLabel: item?.projectLabel || fallbackProjectLabel(item?.projectPath),
    sessionLabel:
      item?.sessionLabel ||
      `${providerLabel(provider)} • ${sessionFingerprint(sessionId)}`,
    provider,
    message: String(item?.message || ""),
    sentAt: String(item?.sentAt || "").trim() || new Date().toISOString(),
    answeredAt,
    status: normalizedStatus,
    response: String(item?.response || ""),
    exitCode: typeof item?.exitCode === "number" ? item.exitCode : null,
    seenAt:
      String(item?.seenAt || "").trim() ||
      (normalizedStatus === "queued" ? null : answeredAt || String(item?.sentAt || "").trim() || new Date().toISOString()),
  };
}

function normalizeProjectSummarySnapshot(snapshot) {
  return {
    id: String(snapshot?.id || "").trim() || makeEntryId(),
    projectPath: String(snapshot?.projectPath || "").trim() || "",
    createdAt: String(snapshot?.createdAt || "").trim() || null,
    provider: String(snapshot?.provider || "").trim() || "session",
    sessionId: String(snapshot?.sessionId || "").trim() || null,
    sessionLabel: String(snapshot?.sessionLabel || "").trim() || "",
    sourceEntryCount: Number.parseInt(String(snapshot?.sourceEntryCount || "0"), 10) || 0,
    sourceSessionCount: Number.parseInt(String(snapshot?.sourceSessionCount || "0"), 10) || 0,
    summary: String(snapshot?.summary || ""),
  };
}

function projectWithActiveSession(project, sessionId) {
  if (!project || !Array.isArray(project.sessions) || !sessionId) {
    return project;
  }

  const sessions = project.sessions.map((session) => ({
    ...session,
    active: session.sessionId === sessionId,
  }));
  const activeSession =
    sessions.find((session) => session.sessionId === sessionId) ||
    sessions.find((session) => session.active) ||
    project.activeSession ||
    null;

  return {
    ...project,
    provider: activeSession?.provider || project.provider || "claude",
    sessionId: activeSession?.sessionId || null,
    activeSessionId: activeSession?.sessionId || null,
    activeSessionLabel: activeSession?.slug || null,
    activeSession,
    sessions,
  };
}

function replaceProject(updatedProject) {
  if (!updatedProject?.path) {
    return;
  }

  state.projects = state.projects.map((project) =>
    project.path === updatedProject.path ? updatedProject : project,
  );
}

function upsertProject(projectDetails) {
  if (!projectDetails?.path) {
    return;
  }

  const existingIndex = state.projects.findIndex((project) => project.path === projectDetails.path);
  if (existingIndex >= 0) {
    state.projects.splice(existingIndex, 1, projectDetails);
  } else {
    state.projects = [...state.projects, projectDetails].sort((left, right) =>
      (left.displayName || left.slug || left.path).localeCompare(right.displayName || right.slug || right.path),
    );
  }
}

function removeProject(projectPath) {
  state.projects = state.projects.filter((project) => project.path !== projectPath);
}

function syncSelectedProject(preferredPath = "", { preferCurrent = true } = {}) {
  const choices = state.projects.map((project) => project.path);
  if (preferCurrent && state.selectedProject && choices.includes(state.selectedProject)) {
    return;
  }

  if (preferredPath && choices.includes(preferredPath)) {
    state.selectedProject = preferredPath;
    return;
  }

  if (state.selectedProject && choices.includes(state.selectedProject)) {
    return;
  }

  state.selectedProject = choices[0] || "";
}

function syncSelectedSession(preferredSessionId = "", { preferCurrent = true } = {}) {
  const project = currentProject();
  const sessions = Array.isArray(project?.sessions) ? project.sessions : [];
  const choices = sessions.map((session) => session.sessionId).filter(Boolean);

  if (preferCurrent && state.selectedSessionId && choices.includes(state.selectedSessionId)) {
    return;
  }

  if (preferredSessionId && choices.includes(preferredSessionId)) {
    state.selectedSessionId = preferredSessionId;
    return;
  }

  if (project?.activeSessionId && choices.includes(project.activeSessionId)) {
    state.selectedSessionId = project.activeSessionId;
    return;
  }

  state.selectedSessionId = choices[0] || "";
}

function syncProjectRootSelection(preferredRoot = "", { preferCurrent = true } = {}) {
  const choices = state.projectRoots.map((root) => root.path);

  if (preferCurrent && state.projectModalRoot && choices.includes(state.projectModalRoot)) {
    return;
  }

  if (preferredRoot && choices.includes(preferredRoot)) {
    state.projectModalRoot = preferredRoot;
    return;
  }

  state.projectModalRoot = choices[0] || "";
}

function syncProjectRepoSelection(preferredPath = "", { preferCurrent = true } = {}) {
  if (state.projectModalMode !== "existing") {
    state.projectModalRepoPath = "";
    return;
  }

  const repos = currentRootRepos();
  const choices = repos.map((repo) => repo.path);

  if (preferCurrent && state.projectModalRepoPath && choices.includes(state.projectModalRepoPath)) {
    return;
  }

  if (preferredPath && choices.includes(preferredPath)) {
    state.projectModalRepoPath = preferredPath;
    return;
  }

  const firstUntracked = repos.find((repo) => !repo.tracked)?.path || "";
  state.projectModalRepoPath = firstUntracked || choices[0] || "";
}

function persistThreadEntries() {
  try {
    localStorage.setItem(threadCacheKey, JSON.stringify(state.threadEntries));
  } catch (_error) {
    // Ignore storage failures.
  }
}

function restoreThreadEntries() {
  try {
    const raw = localStorage.getItem(threadCacheKey);
    if (!raw) {
      return;
    }
    const parsed = JSON.parse(raw);
    state.threadEntries = Array.isArray(parsed) ? parsed : [];
  } catch (_error) {
    state.threadEntries = [];
  }
}

function cacheProjects(payload) {
  try {
    localStorage.setItem(
      projectCacheKey,
      JSON.stringify({
        selectedProject: state.selectedProject || "",
        selectedSessionId: state.selectedSessionId || "",
        defaultProject: payload.defaultProject || "",
        projects: Array.isArray(payload.projects) ? payload.projects : [],
      }),
    );
  } catch (_error) {
    // Ignore storage failures.
  }
}

function restoreCachedProjects() {
  try {
    const raw = localStorage.getItem(projectCacheKey);
    if (!raw) {
      return false;
    }

    const payload = JSON.parse(raw);
    const projects = Array.isArray(payload.projects) ? payload.projects : [];
    if (projects.length === 0) {
      return false;
    }

    state.projects = projects;
    state.projectsLoading = true;
    syncSelectedProject(payload.selectedProject || payload.defaultProject || "", {
      preferCurrent: false,
    });
    syncSelectedSession(payload.selectedSessionId || "", {
      preferCurrent: false,
    });
    return true;
  } catch (_error) {
    return false;
  }
}

function currentThreadEntries() {
  return state.threadEntries
    .filter(
      (entry) =>
        entry.projectPath === state.selectedProject &&
        entry.sessionId === state.selectedSessionId,
    )
    .sort((left, right) => new Date(left.sentAt).getTime() - new Date(right.sentAt).getTime());
}

function queueEntries() {
  const rankForStatus = (status) => {
    if (status === "queued") {
      return 0;
    }
    if (status === "answered") {
      return 1;
    }
    return 2;
  };

  return [...state.threadEntries].sort((left, right) => {
    const rankDiff = rankForStatus(left.status) - rankForStatus(right.status);
    if (rankDiff !== 0) {
      return rankDiff;
    }

    const leftTime = new Date(left.answeredAt || left.sentAt || 0).getTime();
    const rightTime = new Date(right.answeredAt || right.sentAt || 0).getTime();
    return rightTime - leftTime;
  });
}

function pendingEntryForSession(projectPath, sessionId) {
  return (
    state.threadEntries.find(
      (entry) =>
        entry.projectPath === projectPath &&
        entry.sessionId === sessionId &&
        entry.status === "queued",
    ) || null
  );
}

function entrySentAtMs(entry) {
  const sentAtMs = new Date(entry?.sentAt || 0).getTime();
  return Number.isFinite(sentAtMs) ? sentAtMs : 0;
}

function entryAgePastGraceWindow(entry) {
  const sentAtMs = entrySentAtMs(entry);
  return sentAtMs > 0 && Date.now() - sentAtMs > queuedDispatchGraceMs;
}

function sessionCompletionTimestampMs(project, session) {
  const completionValue =
    session?.lastResponse ||
    project?.lastResponse ||
    session?.lastDispatch ||
    project?.lastDispatch ||
    "";
  const completionMs = new Date(completionValue || 0).getTime();
  return Number.isFinite(completionMs) ? completionMs : 0;
}

function queuedEntryCanUseMailboxFallback(entry, project, session, status) {
  if (status !== "completed" && status !== "failed") {
    return false;
  }

  if (!entryAgePastGraceWindow(entry)) {
    return false;
  }

  const sentAtMs = new Date(entry?.sentAt || 0).getTime();
  const completionMs = sessionCompletionTimestampMs(project, session);
  if (!Number.isFinite(sentAtMs) || sentAtMs <= 0 || completionMs <= 0) {
    return false;
  }

  return completionMs >= sentAtMs - 5 * 60 * 1000;
}

function completedSessionsMatchingEntry(project, entry) {
  if (!project || !Array.isArray(project.sessions)) {
    return [];
  }

  const sentAtMs = entrySentAtMs(entry);
  return project.sessions.filter((session) => {
    const completionMs = sessionCompletionTimestampMs(project, session);
    if (completionMs <= 0) {
      return false;
    }
    if (sentAtMs <= 0) {
      return true;
    }
    return completionMs >= sentAtMs - 5 * 60 * 1000;
  });
}

function updateThreadEntry(entryId, updater) {
  state.threadEntries = state.threadEntries.map((entry) => {
    if (entry.id !== entryId) {
      return entry;
    }
    const patch = typeof updater === "function" ? updater(entry) : updater;
    return {
      ...entry,
      ...patch,
    };
  });
  persistThreadEntries();
}

function appendThreadEntry(entry) {
  state.threadEntries = [...state.threadEntries, entry];
  persistThreadEntries();
}

function sessionStatusLabel(entry) {
  if (entry.status === "queued") {
    return "processing";
  }
  if (entry.status === "failed") {
    return "failed";
  }
  return "checked off";
}

function entryHasReturned(entry) {
  return entry?.status === "answered" || entry?.status === "failed";
}

function entryIsUnread(entry) {
  return entryHasReturned(entry) && !String(entry?.seenAt || "").trim();
}

function hasUnreadQueueEntries() {
  return state.threadEntries.some((entry) => entryIsUnread(entry));
}

function markThreadEntriesSeen({ projectPath = "", sessionId = "", requestId = "" } = {}) {
  let changed = false;
  const normalizedRequestId = String(requestId || "").trim();

  state.threadEntries = state.threadEntries.map((entry) => {
    if (!entryHasReturned(entry) || String(entry?.seenAt || "").trim()) {
      return entry;
    }

    if (projectPath && entry.projectPath !== projectPath) {
      return entry;
    }

    if (sessionId && entry.sessionId !== sessionId) {
      return entry;
    }

    if (normalizedRequestId && String(entry.requestId || "").trim() !== normalizedRequestId) {
      return entry;
    }

    changed = true;
    return {
      ...entry,
      seenAt: new Date().toISOString(),
    };
  });

  if (changed) {
    persistThreadEntries();
  }
}

function sessionIsBusy(session) {
  if (session?.pendingCreation) {
    return true;
  }
  const status = String(session?.status || "").trim().toLowerCase();
  return status === "running" || status === "dispatched";
}

function decorateCopyButton(button, copyKey) {
  const copied = copyFeedbackActive(copyKey);
  button.classList.toggle("is-copied", copied);
  button.innerHTML = copied ? checkIconMarkup() : copyIconMarkup();
}

function buildCopyButton({ copyKey, label, text }) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "copy-button copy-button-floating";
  button.setAttribute("aria-label", label);
  decorateCopyButton(button, copyKey);
  button.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    try {
      await copyText(text);
      markCopied(copyKey);
    } catch (error) {
      showError(error);
    }
  });
  return button;
}

function renderProjectOptions() {
  if (controlInteractionLocked("project-select")) {
    return;
  }
  elements.projectSelect.innerHTML = "";

  if (state.projectsLoading && state.projects.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "Loading projects…";
    elements.projectSelect.append(option);
    elements.projectSelect.disabled = true;
    return;
  }

  if (state.projects.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No projects";
    elements.projectSelect.append(option);
    elements.projectSelect.disabled = true;
    return;
  }

  for (const project of state.projects) {
    const option = document.createElement("option");
    option.value = project.path;
    option.textContent = project.displayName || project.slug || project.path;
    elements.projectSelect.append(option);
  }

  elements.projectSelect.disabled = state.projectsLoading || state.dispatchPending;
  elements.projectSelect.value = state.selectedProject;
}

function renderSessionOptions() {
  if (controlInteractionLocked("session-select")) {
    return;
  }
  elements.sessionSelect.innerHTML = "";

  const project = currentProject();
  const sessions = Array.isArray(project?.sessions) ? project.sessions : [];
  const selectedSession =
    sessions.find((session) => session.sessionId === state.selectedSessionId) || null;

  if (!project) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "Session";
    elements.sessionSelect.append(option);
    elements.sessionSelect.disabled = true;
    elements.sessionControl?.classList.remove("is-loading");
    return;
  }

  if (sessions.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No sessions";
    elements.sessionSelect.append(option);
    elements.sessionSelect.disabled = true;
    elements.sessionControl?.classList.remove("is-loading");
    return;
  }

  for (const session of sessions) {
    const option = document.createElement("option");
    option.value = session.sessionId || "";
    option.textContent = sessionOptionLabel(session);
    elements.sessionSelect.append(option);
  }

  elements.sessionControl?.classList.toggle("is-loading", Boolean(selectedSession?.pendingCreation));
  elements.sessionSelect.disabled =
    state.projectsLoading || state.sessionSwitchPending || state.dispatchPending;
  elements.sessionSelect.value = state.selectedSessionId;
}

function repoOptionLabel(repo) {
  if (!repo) {
    return "";
  }

  if (repo.tracked) {
    const sessionCount = Number(repo.sessionCount || 0);
    const trackedLabel = sessionCount > 0 ? `${sessionCount} session${sessionCount === 1 ? "" : "s"}` : "tracked";
    return `${repo.name} • ${trackedLabel}`;
  }

  if (repo.gitRepo) {
    return `${repo.name} • git`;
  }

  return repo.name;
}

function updateBodyModalState() {
  document.body.classList.toggle(
    "modal-open",
    Boolean(currentModalThread()) || state.projectModalOpen || Boolean(state.summaryModalProject),
  );
}

function renderProjectModal() {
  if (state.projectModalOpen && controlInteractionLocked("project-modal")) {
    return;
  }
  if (!state.projectModalOpen) {
    elements.projectModal.hidden = true;
    return;
  }

  const roots = state.projectRoots;
  const repos = currentRootRepos();
  const selectedRepo = repos.find((repo) => repo.path === state.projectModalRepoPath) || null;

  elements.projectRootSelect.innerHTML = "";
  if (state.projectRootsLoading && roots.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "Loading roots…";
    elements.projectRootSelect.append(option);
    elements.projectRootSelect.disabled = true;
  } else if (roots.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No roots";
    elements.projectRootSelect.append(option);
    elements.projectRootSelect.disabled = true;
  } else {
    for (const root of roots) {
      const option = document.createElement("option");
      option.value = root.path;
      option.textContent = root.label || root.path;
      elements.projectRootSelect.append(option);
    }
    elements.projectRootSelect.disabled = state.projectModalPending || state.projectRootsLoading;
    elements.projectRootSelect.value = state.projectModalRoot;
  }

  elements.projectRepoSelect.hidden = state.projectModalMode !== "existing";
  elements.projectNameInput.hidden = state.projectModalMode !== "new";

  elements.projectRepoSelect.innerHTML = "";
  if (state.projectModalMode === "existing") {
    if (!state.projectModalRoot) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "Choose root…";
      elements.projectRepoSelect.append(option);
      elements.projectRepoSelect.disabled = true;
    } else if (repos.length === 0) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "No repos";
      elements.projectRepoSelect.append(option);
      elements.projectRepoSelect.disabled = true;
    } else {
      for (const repo of repos) {
        const option = document.createElement("option");
        option.value = repo.path;
        option.textContent = repoOptionLabel(repo);
        elements.projectRepoSelect.append(option);
      }
      elements.projectRepoSelect.disabled = state.projectModalPending || state.projectRootsLoading;
      elements.projectRepoSelect.value = state.projectModalRepoPath;
    }
  }

  elements.projectNameInput.value = state.projectModalName;
  elements.projectNameInput.disabled = state.projectModalPending || !state.projectModalRoot;
  elements.projectProviderSelect.value = state.projectModalProvider;
  elements.projectProviderSelect.disabled = state.projectModalPending;

  elements.projectModeExisting.classList.toggle("is-active", state.projectModalMode === "existing");
  elements.projectModeNew.classList.toggle("is-active", state.projectModalMode === "new");

  const canCreate =
    !state.projectModalPending &&
    !state.projectRootsLoading &&
    Boolean(state.projectModalRoot) &&
    (
      state.projectModalMode === "existing"
        ? Boolean(state.projectModalRepoPath)
        : Boolean(state.projectModalName.trim())
    );
  elements.projectCreateButton.disabled = !canCreate;
  elements.projectCreateButton.querySelector(".button-text").textContent =
    state.projectModalPending
      ? "Adding…"
      : state.projectModalMode === "existing" && selectedRepo?.tracked
        ? "New Session"
        : "Add";

  let modalState = state.projectModalStatus;
  if (!modalState) {
    if (state.projectModalMode === "existing" && selectedRepo?.tracked) {
      modalState = "Tracked repo";
    }
  }
  setText(elements.projectModalState, modalState, { empty: !modalState });

  elements.projectModal.hidden = false;
}

async function refreshProjectRoots() {
  if (state.projectRootsRefreshPromise) {
    return state.projectRootsRefreshPromise;
  }

  state.projectRootsRefreshPromise = (async () => {
    state.projectRootsLoading = true;
    renderAll();
    try {
      const payload = await fetchJson("/v1/project-roots");
      state.projectRoots = Array.isArray(payload.roots) ? payload.roots : [];
      syncProjectRootSelection(state.projectModalRoot, { preferCurrent: false });
      syncProjectRepoSelection(state.projectModalRepoPath, { preferCurrent: false });
    } finally {
      state.projectRootsLoading = false;
      renderAll();
      state.projectRootsRefreshPromise = null;
    }
  })();

  return state.projectRootsRefreshPromise;
}

function renderQueueList() {
  elements.queueList.innerHTML = "";
  const entries = queueEntries();

  if (entries.length === 0) {
    const empty = document.createElement("div");
    empty.className = "queue-empty is-empty";
    empty.textContent = "No work yet.";
    elements.queueList.append(empty);
    return;
  }

  for (const entry of entries) {
    const clickable = entry.status === "answered" || entry.status === "failed";
    const card = document.createElement("article");
    card.className = `queue-card ${entry.status === "queued" ? "processing" : entry.status === "answered" ? "done" : "failed"}`;
    if (clickable) {
      card.classList.add("clickable");
      card.tabIndex = 0;
      card.setAttribute("role", "button");
      card.addEventListener("click", () => {
        void openSessionThread(entry.projectPath, entry.sessionId, {
          focusRequestId: String(entry.requestId || "").trim(),
        });
      });
      card.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          void openSessionThread(entry.projectPath, entry.sessionId, {
            focusRequestId: String(entry.requestId || "").trim(),
          });
        }
      });
    }

    const head = document.createElement("div");
    head.className = "queue-head";

    const project = document.createElement("div");
    project.className = "queue-project";
    project.textContent = entryProjectLabel(entry);

    const chip = document.createElement("div");
    chip.className = `queue-chip ${entry.status === "queued" ? "processing" : entry.status === "answered" ? "done" : "failed"}`;
    chip.textContent = sessionStatusLabel(entry);

    head.append(project, chip);

    const session = document.createElement("div");
    session.className = "queue-session";
    session.textContent = entrySessionLabel(entry);

    const meta = document.createElement("div");
    meta.className = "queue-meta";

    const timestamp = document.createElement("div");
    timestamp.className = "queue-time";
    timestamp.textContent = formatTimestamp(entry.sentAt);

    meta.append(session, timestamp);

    const message = document.createElement("div");
    message.className = "queue-message";
    message.textContent = entry.message;

    const copyButton = buildCopyButton({
      copyKey: `queue:${entry.id}:message`,
      label: "Copy message",
      text: entry.message,
    });

    card.append(copyButton, head, meta, message);

    elements.queueList.append(card);
  }
}

function buildThreadCard({ entry, direction, copyKey, copyLabel, text, copyTextValue, metaText, failed = false }) {
  const card = document.createElement("article");
  card.className = `thread-card ${direction} detail-card${failed ? " failed" : ""}`;

  if (copyTextValue) {
    const copyButton = buildCopyButton({
      copyKey,
      label: copyLabel,
      text: copyTextValue,
    });
    card.append(copyButton);
  }

  const meta = document.createElement("div");
  meta.className = "thread-meta";
  meta.textContent = metaText;

  const body = document.createElement("div");
  body.className = "thread-text";
  renderRichText(body, text, { emptyText: direction === "inbound" ? "Processing…" : "" });

  card.append(meta, body);
  return card;
}

function buildHistoryGroup(entry) {
  const group = document.createElement("div");
  group.className = "history-group";
  group.dataset.requestId = entry.requestId || "";

  group.append(
    buildThreadCard({
      entry,
      direction: "outbound",
      copyKey: `history:${entry.requestId}:message`,
      copyLabel: "Copy message",
      text: entry.message,
      copyTextValue: entry.message,
      metaText: formatTimestamp(entry.sentAt),
    }),
  );

  const inboundText =
    entry.status === "queued"
      ? "Processing…"
      : entry.response || (entry.status === "failed" ? "Failed." : "");
  const inboundMeta =
    entry.status === "queued"
      ? "processing"
      : formatTimestamp(entry.answeredAt) || (entry.status === "failed" ? "failed" : "");

  group.append(
    buildThreadCard({
      entry,
      direction: "inbound",
      copyKey: `history:${entry.requestId}:response`,
      copyLabel: "Copy response",
      text: inboundText,
      copyTextValue: entry.status === "queued" ? "" : inboundText,
      metaText: inboundMeta,
      failed: entry.status === "failed",
    }),
  );

  return group;
}

function renderModal() {
  const modalThread = currentModalThread();
  if (!modalThread) {
    setText(elements.detailHistoryState, "", { empty: true });
    clearNode(elements.detailHistoryList);
    elements.detailModal.hidden = true;
    return;
  }

  const project = projectByPath(modalThread.projectPath);
  const session =
    project?.sessions?.find((item) => item.sessionId === modalThread.sessionId) ||
    normalizeHistoryItem({
      projectPath: modalThread.projectPath,
      sessionId: modalThread.sessionId,
      provider: "session",
    });
  const historyState = historyStateFor(modalThread.projectPath, modalThread.sessionId);

  elements.detailProject.textContent =
    project?.displayName || fallbackProjectLabel(modalThread.projectPath);
  elements.detailSession.textContent = sessionOptionLabel(session);

  if (historyState.error) {
    setText(elements.detailHistoryState, "History unavailable", { empty: false });
  } else if (historyState.loading && !historyState.initialized) {
    setText(elements.detailHistoryState, "Loading thread", { empty: false });
  } else if (historyState.nextCursor) {
    setText(elements.detailHistoryState, "Scroll up for older messages", { empty: false });
  } else {
    setText(elements.detailHistoryState, "", { empty: true });
  }

  clearNode(elements.detailHistoryList);
  if (!historyState.initialized && historyState.loading) {
    const card = document.createElement("div");
    card.className = "history-state-card";
    card.textContent = "Loading thread…";
    elements.detailHistoryList.append(card);
  } else if (historyState.items.length === 0) {
    const card = document.createElement("div");
    card.className = "history-state-card";
    card.textContent = "No mirrored messages yet.";
    elements.detailHistoryList.append(card);
  } else {
    for (const entry of historyState.items) {
      elements.detailHistoryList.append(buildHistoryGroup(entry));
    }
  }

  elements.detailModal.hidden = false;
}

function buildSummaryCard(snapshot) {
  const card = document.createElement("article");
  card.className = "summary-card";

  const copyButton = buildCopyButton({
    copyKey: `summary:${snapshot.id}`,
    label: "Copy summary",
    text: snapshot.summary,
  });
  card.append(copyButton);

  const head = document.createElement("div");
  head.className = "summary-head";

  const timestamp = document.createElement("div");
  timestamp.className = "summary-timestamp";
  timestamp.textContent = formatTimestamp(snapshot.createdAt) || "Saved summary";

  const sourceMeta = document.createElement("div");
  sourceMeta.className = "summary-source-meta";
  const sourceCountLabel = `${snapshot.sourceEntryCount} note${snapshot.sourceEntryCount === 1 ? "" : "s"}`;
  const sessionCountLabel = `${snapshot.sourceSessionCount} session${snapshot.sourceSessionCount === 1 ? "" : "s"}`;
  const providerText = snapshot.sessionLabel || providerLabel(snapshot.provider);
  sourceMeta.textContent = `${providerText} • ${sourceCountLabel} • ${sessionCountLabel}`;

  head.append(timestamp, sourceMeta);

  const body = document.createElement("div");
  body.className = "thread-text";
  renderRichText(body, snapshot.summary, { emptyText: "No saved summary yet." });

  card.append(head, body);
  return card;
}

function renderSummaryModal() {
  const project = currentSummaryProject();
  if (!project) {
    setText(elements.summaryState, "", { empty: true });
    clearNode(elements.summaryList);
    elements.summaryModal.hidden = true;
    return;
  }

  const summaryState = projectSummaryStateFor(project.path);
  const summarySession =
    summaryState.summarySession ||
    currentSession() ||
    project.activeSession ||
    project.sessions?.find((session) => session.active) ||
    project.sessions?.[0] ||
    null;

  elements.summaryProject.textContent = project.displayName || project.slug || fallbackProjectLabel(project.path);
  elements.summarySession.textContent =
    summarySession?.sessionId
      ? `${sessionOptionLabel(summarySession)} • snapshots`
      : "Project snapshots";

  const refreshButtonLabel = elements.summaryRefreshButton.querySelector(".button-text");
  if (refreshButtonLabel) {
    refreshButtonLabel.textContent = summaryState.pending ? "Refreshing…" : "New summary";
  }
  elements.summaryRefreshButton.disabled =
    summaryState.pending || !project.path || !summarySession?.sessionId;

  if (summaryState.pending) {
    setText(elements.summaryState, "Refreshing summary", { empty: false });
  } else if (summaryState.error) {
    setText(elements.summaryState, summaryState.error, { empty: false });
  } else if (!summaryState.initialized && summaryState.loading) {
    setText(elements.summaryState, "Loading saved summary", { empty: false });
  } else if (summaryState.latestSnapshot?.createdAt) {
    setText(
      elements.summaryState,
      `Latest snapshot • ${formatTimestamp(summaryState.latestSnapshot.createdAt)}`,
      { empty: false },
    );
  } else {
    setText(elements.summaryState, "No saved summary yet", { empty: false });
  }

  clearNode(elements.summaryList);
  if (!summaryState.initialized && summaryState.loading) {
    const card = document.createElement("div");
    card.className = "history-state-card";
    card.textContent = "Loading saved summary…";
    elements.summaryList.append(card);
  } else if (summaryState.error && summaryState.snapshots.length === 0) {
    const card = document.createElement("div");
    card.className = "history-state-card";
    card.textContent = summaryState.error;
    elements.summaryList.append(card);
  } else if (summaryState.snapshots.length === 0) {
    const card = document.createElement("div");
    card.className = "history-state-card";
    card.textContent = "No saved summary yet.";
    elements.summaryList.append(card);
  } else {
    for (const snapshot of summaryState.snapshots) {
      elements.summaryList.append(buildSummaryCard(snapshot));
    }
  }

  elements.summaryModal.hidden = false;
}

function projectIsBusy(project) {
  const projectStatus = String(project?.status || "").trim().toLowerCase();
  return projectStatus === "running" || projectStatus === "dispatched";
}

function updateMailboxState() {
  const pending = pendingEntryForSession(state.selectedProject, state.selectedSessionId);
  if (pending) {
    setText(elements.mailboxState, "processing", { empty: false });
    return;
  }

  const project = currentProject();
  const session = currentSession();
  if (session?.pendingCreation) {
    setText(elements.mailboxState, "setting up", { empty: false });
    return;
  }
  if (projectIsBusy(project)) {
    setText(elements.mailboxState, "processing", { empty: false });
    return;
  }

  const entries = currentThreadEntries();
  if (entries.length === 0) {
    setText(elements.mailboxState, "", { empty: true });
    return;
  }

  const latest = entries[entries.length - 1];
  if (latest.status === "failed") {
    setText(elements.mailboxState, "failed", { empty: false });
    return;
  }

  if (latest.status === "answered") {
    setText(elements.mailboxState, "checked off", { empty: false });
    return;
  }

  setText(elements.mailboxState, "", { empty: true });
}

function updateQueueUnreadOrb() {
  if (!elements.queueUnreadOrb) {
    return;
  }

  elements.queueUnreadOrb.hidden = !hasUnreadQueueEntries();
}

function updateSendAvailability() {
  const project = currentProject();
  const session = currentSession();
  const hasPending = Boolean(pendingEntryForSession(state.selectedProject, state.selectedSessionId));
  const sessionBusy = hasPending || sessionIsBusy(session);
  const projectBusy = projectIsBusy(project);
  const canSend =
    !state.projectsLoading &&
    !state.dispatchPending &&
    !state.sessionSwitchPending &&
    Boolean(state.selectedProject) &&
    Boolean(state.selectedSessionId) &&
    !sessionBusy &&
    !projectBusy;

  elements.dispatchButton.disabled = !canSend;
  elements.dispatchButton.querySelector(".button-text").textContent = state.dispatchPending
    ? "Sending…"
    : sessionBusy || projectBusy
      ? "Processing…"
      : "Send";
}

function updateThreadButtonAvailability() {
  const session = currentSession();
  elements.sessionThreadButton.disabled =
    state.projectsLoading ||
    !state.selectedProject ||
    !state.selectedSessionId ||
    Boolean(session?.pendingCreation);
}

function updateSummaryButtonAvailability() {
  elements.projectSummaryButton.disabled = state.projectsLoading || !state.selectedProject;
}

function updateQueueChrome() {
  elements.queueSection.classList.toggle("is-collapsed", state.queueCollapsed);
  elements.queueToggle.setAttribute("aria-expanded", String(!state.queueCollapsed));
  elements.queueToggle.setAttribute(
    "aria-label",
    state.queueCollapsed ? "Expand queue" : "Collapse queue",
  );
}

function renderAll() {
  pruneCopyFeedback();
  renderProjectOptions();
  renderSessionOptions();
  renderQueueList();
  renderModal();
  renderSummaryModal();
  renderProjectModal();
  updateMailboxState();
  updateQueueUnreadOrb();
  updateSendAvailability();
  updateThreadButtonAvailability();
  updateSummaryButtonAvailability();
  updateQueueChrome();
  updateBodyModalState();
}

async function reconcileThreadEntries() {
  const pendingEntries = state.threadEntries.filter((entry) => entry.status === "queued");
  if (pendingEntries.length === 0) {
    renderAll();
    return;
  }

  const statusByProject = new Map();
  const readsByRequest = new Map();

  for (const entry of pendingEntries) {
    if (!statusByProject.has(entry.projectPath)) {
      try {
        const payload = await fetchJson(
          `/v1/status?project=${encodeURIComponent(entry.projectPath)}`,
        );
        statusByProject.set(entry.projectPath, payload);
      } catch (error) {
        statusByProject.set(entry.projectPath, { error });
      }
    }

    const statusPayload = statusByProject.get(entry.projectPath) || {};
    const project = projectByPath(entry.projectPath);
    const session = project?.sessions?.find((item) => item.sessionId === entry.sessionId) || null;
    const mailboxStatus = statusPayload.mailboxStatus || {};
    const status = String(
      mailboxStatus.state || session.status || project.status || "",
    )
      .trim()
      .toLowerCase();
    const matchingCompletedSessions = completedSessionsMatchingEntry(project, entry);
    const mailboxCompletionFallbackSession =
      session ||
      (matchingCompletedSessions.length === 1 ? matchingCompletedSessions[0] : null);

    if (!project || !session) {
      if (
        mailboxCompletionFallbackSession &&
        entryAgePastGraceWindow(entry) &&
        (status === "completed" || status === "failed")
      ) {
        const fallbackReadKey = `${entry.projectPath}:${String(mailboxStatus.request_id || "").trim() || status}:fallback`;
        if (!readsByRequest.has(fallbackReadKey)) {
          try {
            const payload = await fetchJson(
              `/v1/read?project=${encodeURIComponent(entry.projectPath)}&raw=1`,
            );
            readsByRequest.set(fallbackReadKey, payload.output || "");
          } catch (error) {
            readsByRequest.set(fallbackReadKey, status === "failed" ? error.message : "");
          }
        }

        updateThreadEntry(entry.id, {
          status: status === "completed" ? "answered" : "failed",
          sessionId: mailboxCompletionFallbackSession.sessionId || entry.sessionId,
          sessionLabel: sessionOptionLabel(mailboxCompletionFallbackSession),
          answeredAt:
            mailboxStatus.completed_at ||
            mailboxCompletionFallbackSession.lastResponse ||
            project?.lastResponse ||
            new Date().toISOString(),
          requestId: String(mailboxStatus.request_id || "").trim() || String(entry.requestId || "").trim(),
          response: readsByRequest.get(fallbackReadKey) || (status === "failed" ? "Failed." : ""),
          seenAt: null,
        });
      } else if (entryAgePastGraceWindow(entry)) {
        updateThreadEntry(entry.id, {
          status: "failed",
          answeredAt: new Date().toISOString(),
          response: "This queued item no longer matches a tracked session. Please retry.",
          seenAt: null,
        });
      }
      continue;
    }

    const liveRequestId = String(mailboxStatus.request_id || "").trim();
    const sentAtMs = new Date(entry.sentAt || 0).getTime();
    const mailboxDispatchMs = new Date(mailboxStatus.dispatched_at || 0).getTime();
    const trackedRequestId = String(entry.requestId || "").trim();
    const requestLooksFresh =
      Boolean(liveRequestId) &&
      Number.isFinite(sentAtMs) &&
      Number.isFinite(mailboxDispatchMs) &&
      mailboxDispatchMs >= sentAtMs - 1000;
    const canUseMailboxFallback = queuedEntryCanUseMailboxFallback(
      entry,
      project,
      session,
      status,
    );

    if (!trackedRequestId && requestLooksFresh) {
      updateThreadEntry(entry.id, {
        requestId: liveRequestId,
      });
    }

    const effectiveRequestId = trackedRequestId || (requestLooksFresh ? liveRequestId : "");
    if (effectiveRequestId && liveRequestId && effectiveRequestId !== liveRequestId) {
      if (canUseMailboxFallback) {
        // Fall through and bind this stale local queue card to the completed mailbox result.
      } else {
        if (entryAgePastGraceWindow(entry) && status !== "running" && status !== "dispatched") {
          updateThreadEntry(entry.id, {
            status: "failed",
            answeredAt: new Date().toISOString(),
            response: "This queued item never matched the live mailbox request. Please retry.",
            seenAt: null,
          });
        }
        continue;
      }
    }

    if (status === "running" || status === "dispatched") {
      continue;
    }

    if (status !== "completed" && status !== "failed") {
      const lastDispatchMs = new Date(session.lastDispatch || 0).getTime();
      if (
        status === "idle" &&
        Number.isFinite(sentAtMs) &&
        Date.now() - sentAtMs > queuedDispatchGraceMs &&
        (!Number.isFinite(lastDispatchMs) || lastDispatchMs < sentAtMs)
      ) {
        updateThreadEntry(entry.id, {
          status: "failed",
          answeredAt: new Date().toISOString(),
          response: "Dispatch did not start. Please retry.",
          seenAt: null,
        });
      }
      continue;
    }

    if (effectiveRequestId && liveRequestId && effectiveRequestId !== liveRequestId) {
      continue;
    }

    if (!effectiveRequestId && liveRequestId && !requestLooksFresh) {
      if (canUseMailboxFallback) {
        // Fall through and reconcile from the completed mailbox/session state.
      } else {
        if (entryAgePastGraceWindow(entry)) {
          updateThreadEntry(entry.id, {
            status: "failed",
            answeredAt: new Date().toISOString(),
            response: "This queued item never attached to a live request. Please retry.",
            seenAt: null,
          });
        }
        continue;
      }
    }

    const readKey = `${entry.projectPath}:${effectiveRequestId || liveRequestId || status}`;
    if (!readsByRequest.has(readKey)) {
      try {
        const payload = await fetchJson(
          `/v1/read?project=${encodeURIComponent(entry.projectPath)}&raw=1`,
        );
        readsByRequest.set(readKey, payload.output || "");
      } catch (error) {
        readsByRequest.set(readKey, status === "failed" ? error.message : "");
      }
    }

    updateThreadEntry(entry.id, {
      status: status === "completed" ? "answered" : "failed",
      answeredAt: session?.lastResponse || project?.lastResponse || new Date().toISOString(),
      requestId: effectiveRequestId || liveRequestId || trackedRequestId,
      response: readsByRequest.get(readKey) || (status === "failed" ? "Failed." : ""),
      seenAt: null,
    });
  }

  renderAll();

  const modalThread = currentModalThread();
  if (modalThread) {
    const historyState = historyStateFor(modalThread.projectPath, modalThread.sessionId);
    const hasPendingHistory =
      Boolean(pendingEntryForSession(modalThread.projectPath, modalThread.sessionId)) ||
      historyState.items.some((entry) => entry.status === "queued");
    if (hasPendingHistory) {
      void loadSessionHistory(modalThread.projectPath, modalThread.sessionId, {
        reset: true,
      });
    }
  }
}

async function refreshProjects() {
  if (state.projectsRefreshPromise) {
    return state.projectsRefreshPromise;
  }

  state.projectsRefreshPromise = (async () => {
    state.projectsLoading = true;
    renderAll();
    try {
      const payload = await fetchJson("/v1/projects");
      state.projects = Array.isArray(payload.projects) ? payload.projects : [];
      syncSelectedProject(payload.defaultProject || state.selectedProject);
      syncSelectedSession(state.selectedSessionId);
      cacheProjects(payload);
      await reconcileThreadEntries();
    } finally {
      state.projectsLoading = false;
      renderAll();
      state.projectsRefreshPromise = null;
    }
  })();

  return state.projectsRefreshPromise;
}

async function refreshThreads() {
  if (state.threadRefreshPromise) {
    return state.threadRefreshPromise;
  }

  state.threadRefreshPromise = reconcileThreadEntries().finally(() => {
    state.threadRefreshPromise = null;
  });
  return state.threadRefreshPromise;
}

function showError(error) {
  setText(elements.mailboxState, "error", { empty: false });
  renderQueueList();
  updateSendAvailability();
  console.error(error);
}

async function handleSessionSwitch(sessionId) {
  if (!sessionId || state.sessionSwitchPending) {
    return;
  }

  const project = currentProject();
  if (!project) {
    return;
  }

  const selectedSession =
    project.sessions?.find((item) => item.sessionId === sessionId) || null;
  if (selectedSession?.pendingCreation) {
    state.selectedSessionId = sessionId;
    renderAll();
    return;
  }

  state.selectedSessionId = sessionId;
  renderAll();

  if (project.activeSessionId === sessionId) {
    return;
  }

  const optimisticProject = projectWithActiveSession(project, sessionId);
  replaceProject(optimisticProject);
  state.sessionSwitchPending = true;
  renderAll();

  try {
    const payload = await fetchJson("/v1/active-session", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        project: project.path,
        sessionId,
      }),
    });

    if (payload.projectDetails) {
      replaceProject(payload.projectDetails);
      syncSelectedSession(sessionId, { preferCurrent: false });
    }
  } catch (error) {
    await refreshProjects();
    syncSelectedSession("", { preferCurrent: false });
    showError(error);
  } finally {
    state.sessionSwitchPending = false;
    renderAll();
  }
}

async function loadSessionHistory(projectPath, sessionId, { reset = false, appendOlder = false, stickToBottom = false } = {}) {
  if (!projectPath || !sessionId) {
    return historyStateFor(projectPath, sessionId);
  }

  const existing = historyStateFor(projectPath, sessionId);
  if (existing.loading) {
    return existing;
  }

  const cursor = reset ? "0" : appendOlder ? existing.nextCursor : "0";
  if (appendOlder && !cursor) {
    return existing;
  }

  const shouldPreserveScroll =
    appendOlder &&
    currentModalThread()?.projectPath === projectPath &&
    currentModalThread()?.sessionId === sessionId;
  const previousHeight = shouldPreserveScroll ? elements.detailHistoryList.scrollHeight : 0;
  const previousTop = shouldPreserveScroll ? elements.detailHistoryList.scrollTop : 0;

  setHistoryState(projectPath, sessionId, {
    loading: true,
    error: "",
    initialized: existing.initialized && !reset,
  });
  renderAll();

  try {
    const payload = await fetchJson(
      `/v1/history?project=${encodeURIComponent(projectPath)}&sessionId=${encodeURIComponent(sessionId)}&cursor=${encodeURIComponent(cursor || "0")}&limit=${historyPageSize}`,
    );
    const pageItems = (Array.isArray(payload.items) ? payload.items : [])
      .map(normalizeHistoryItem)
      .reverse();
    const fallbackLocal =
      pageItems.length === 0
        ? state.threadEntries
            .filter(
              (entry) =>
                entry.projectPath === projectPath && entry.sessionId === sessionId,
            )
            .map(normalizeHistoryItem)
        : [];

    const nextItems = reset
      ? pageItems.length > 0
        ? pageItems
        : fallbackLocal
      : appendOlder
        ? [...pageItems, ...existing.items]
        : pageItems;

    setHistoryState(projectPath, sessionId, {
      items: nextItems,
      nextCursor: payload.nextCursor || null,
      loading: false,
      initialized: true,
      error: "",
    });
    renderAll();

    if (shouldPreserveScroll) {
      elements.detailHistoryList.scrollTop =
        elements.detailHistoryList.scrollHeight - previousHeight + previousTop;
    } else if (
      stickToBottom &&
      currentModalThread()?.projectPath === projectPath &&
      currentModalThread()?.sessionId === sessionId
    ) {
      window.requestAnimationFrame(() => {
        elements.detailHistoryList.scrollTop = elements.detailHistoryList.scrollHeight;
      });
    }
  } catch (error) {
    setHistoryState(projectPath, sessionId, {
      loading: false,
      initialized: true,
      error: error.message,
    });
    renderAll();
  }

  return historyStateFor(projectPath, sessionId);
}

async function ensureHistoryContainsRequest(projectPath, sessionId, requestId) {
  if (!requestId) {
    return;
  }

  let guard = 0;
  while (
    guard < 20 &&
    !historyStateFor(projectPath, sessionId).items.some((entry) => entry.requestId === requestId) &&
    historyStateFor(projectPath, sessionId).nextCursor
  ) {
    await loadSessionHistory(projectPath, sessionId, { appendOlder: true });
    guard += 1;
  }
}

function scrollHistoryToRequest(requestId) {
  if (!requestId) {
    return;
  }

  const target = [...elements.detailHistoryList.querySelectorAll(".history-group")].find(
    (node) => node.dataset.requestId === requestId,
  );
  if (target) {
    target.scrollIntoView({ block: "center" });
  }
}

async function openSessionThread(projectPath = state.selectedProject, sessionId = state.selectedSessionId, { focusRequestId = "" } = {}) {
  if (!projectPath || !sessionId) {
    return;
  }

  state.summaryModalProject = "";
  state.selectedProject = projectPath;
  state.selectedSessionId = sessionId;
  state.modalThread = {
    projectPath,
    sessionId,
    focusRequestId: String(focusRequestId || "").trim(),
  };
  markThreadEntriesSeen({
    projectPath,
    sessionId,
    requestId: focusRequestId,
  });
  renderAll();

  await loadSessionHistory(projectPath, sessionId, {
    reset: true,
    stickToBottom: !focusRequestId,
  });

  if (focusRequestId) {
    await ensureHistoryContainsRequest(projectPath, sessionId, focusRequestId);
    window.requestAnimationFrame(() => {
      scrollHistoryToRequest(focusRequestId);
    });
  } else {
    window.requestAnimationFrame(() => {
      elements.detailHistoryList.scrollTop = elements.detailHistoryList.scrollHeight;
    });
  }
}

function closeSessionThread() {
  state.modalThread = null;
  renderAll();
}

async function loadProjectSummary(projectPath, { force = false } = {}) {
  if (!projectPath) {
    return projectSummaryStateFor(projectPath);
  }

  const existing = projectSummaryStateFor(projectPath);
  if (existing.loading || existing.pending) {
    return existing;
  }
  if (!force && existing.initialized) {
    return existing;
  }

  setProjectSummaryState(projectPath, {
    loading: true,
    error: "",
  });
  renderAll();

  try {
    const payload = await fetchJson(
      `/v1/project-summary?project=${encodeURIComponent(projectPath)}`,
    );
    setProjectSummaryState(projectPath, {
      loading: false,
      initialized: true,
      error: "",
      latestSnapshot: payload.latestSnapshot
        ? normalizeProjectSummarySnapshot(payload.latestSnapshot)
        : null,
      snapshots: Array.isArray(payload.snapshots)
        ? payload.snapshots.map(normalizeProjectSummarySnapshot)
        : [],
      summarySession: payload.summarySession || null,
    });
  } catch (error) {
    setProjectSummaryState(projectPath, {
      loading: false,
      initialized: true,
      error: error.message,
    });
  }

  renderAll();
  return projectSummaryStateFor(projectPath);
}

async function openProjectSummary(projectPath = state.selectedProject) {
  if (!projectPath) {
    return;
  }

  state.modalThread = null;
  state.projectModalOpen = false;
  state.summaryModalProject = projectPath;
  renderAll();
  await loadProjectSummary(projectPath);
}

function closeProjectSummary() {
  state.summaryModalProject = "";
  renderAll();
}

async function requestNewProjectSummary() {
  const project = currentSummaryProject();
  if (!project?.path) {
    return;
  }

  const summaryState = projectSummaryStateFor(project.path);
  if (summaryState.pending) {
    return;
  }

  const session =
    currentSession() ||
    project.activeSession ||
    project.sessions?.find((item) => item.active) ||
    project.sessions?.[0] ||
    null;
  if (!session?.sessionId) {
    setProjectSummaryState(project.path, {
      error: "No tracked session is available for this project.",
    });
    renderAll();
    return;
  }

  setProjectSummaryState(project.path, {
    pending: true,
    loading: false,
    initialized: true,
    error: "",
    summarySession: {
      sessionId: session.sessionId,
      provider: session.provider,
      label: sessionOptionLabel(session),
    },
  });
  renderAll();

  try {
    const payload = await fetchJson("/v1/project-summary", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        project: project.path,
        sessionId: session.sessionId,
      }),
    });

    setProjectSummaryState(project.path, {
      pending: false,
      loading: false,
      initialized: true,
      error: "",
      latestSnapshot: payload.latestSnapshot
        ? normalizeProjectSummarySnapshot(payload.latestSnapshot)
        : null,
      snapshots: Array.isArray(payload.snapshots)
        ? payload.snapshots.map(normalizeProjectSummarySnapshot)
        : [],
      summarySession: payload.summarySession || null,
    });
  } catch (error) {
    setProjectSummaryState(project.path, {
      pending: false,
      loading: false,
      initialized: true,
      error: error.message,
    });
  }

  renderAll();
}

function setProjectModalMode(mode) {
  state.projectModalMode = mode === "new" ? "new" : "existing";
  state.projectModalStatus = "";
  syncProjectRepoSelection("", { preferCurrent: false });
  renderAll();
}

async function openProjectModal() {
  state.summaryModalProject = "";
  state.modalThread = null;
  state.projectModalOpen = true;
  state.projectModalStatus = "";
  syncProjectRootSelection(state.projectModalRoot, { preferCurrent: false });
  syncProjectRepoSelection(state.projectModalRepoPath, { preferCurrent: false });
  renderAll();
  if (state.projectRoots.length === 0) {
    try {
      await refreshProjectRoots();
    } catch (error) {
      state.projectModalStatus = error.message;
      renderAll();
    }
  }
}

function closeProjectModal() {
  state.projectModalOpen = false;
  state.projectModalPending = false;
  state.projectModalStatus = "";
  renderAll();
}

function optimisticPendingSession({ projectPath, provider }) {
  return {
    slug: "",
    path: projectPath,
    provider,
    sessionId: `pending-create:${Date.now()}:${Math.random().toString(16).slice(2)}`,
    active: true,
    status: "starting",
    dispatchCount: 0,
    lastDispatch: null,
    lastResponse: null,
    providerSessionSeeded: false,
    pendingCreation: true,
    loadingLabel: nextPendingSessionPhrase(),
  };
}

function optimisticProjectForCreate({ mode, root, repoPath, projectName, provider }) {
  const projectPath =
    mode === "existing"
      ? repoPath
      : `${String(root || "").replace(/\/+$/, "")}/${projectName}`;
  const existingProject = projectByPath(projectPath);
  const pendingSession = optimisticPendingSession({ projectPath, provider });

  if (existingProject) {
    const existingSessions = Array.isArray(existingProject.sessions)
      ? existingProject.sessions.map((session) => ({ ...session, active: false }))
      : [];

    return {
      projectPath,
      pendingSessionId: pendingSession.sessionId,
      rollbackProject: JSON.parse(JSON.stringify(existingProject)),
      optimisticProject: {
        ...existingProject,
        provider,
        sessionId: pendingSession.sessionId,
        activeSessionId: pendingSession.sessionId,
        activeSessionLabel: pendingSession.loadingLabel,
        activeSession: pendingSession,
        sessionCount: existingSessions.length + 1,
        sessions: [...existingSessions, pendingSession],
      },
    };
  }

  const displayName = mode === "existing" ? basenameFromPath(projectPath) : projectName;
  return {
    projectPath,
    pendingSessionId: pendingSession.sessionId,
    rollbackProject: null,
    optimisticProject: {
      slug: displayName,
      displayName,
      path: projectPath,
      provider,
      sessionId: pendingSession.sessionId,
      activeSessionId: pendingSession.sessionId,
      activeSessionLabel: pendingSession.loadingLabel,
      activeSession: pendingSession,
      sessionCount: 1,
      sessions: [pendingSession],
      status: "idle",
      dispatchCount: 0,
      lastDispatch: null,
      lastResponse: null,
      registeredAt: null,
    },
  };
}

async function handleProjectCreate(event) {
  event.preventDefault();

  const mode = state.projectModalMode;
  const root = state.projectModalRoot;
  const provider = state.projectModalProvider;
  const repoPath = state.projectModalRepoPath;
  const projectName = state.projectModalName.trim();

  if (!root) {
    state.projectModalStatus = "Choose root";
    renderAll();
    return;
  }

  if (mode === "existing" && !repoPath) {
    state.projectModalStatus = "Choose repo";
    renderAll();
    return;
  }

  if (mode === "new" && !projectName) {
    state.projectModalStatus = "Choose name";
    renderAll();
    return;
  }

  const previousProjectPath = state.selectedProject;
  const previousSessionId = state.selectedSessionId;
  const optimisticState = optimisticProjectForCreate({
    mode,
    root,
    repoPath,
    projectName,
    provider,
  });

  state.projectModalName = "";
  state.projectModalRepoPath = "";
  upsertProject(optimisticState.optimisticProject);
  state.selectedProject = optimisticState.projectPath;
  state.selectedSessionId = optimisticState.pendingSessionId;
  closeProjectModal();
  renderAll();

  try {
    const payload = await fetchJson("/v1/projects", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(
        mode === "existing"
          ? {
              mode,
              root,
              path: repoPath,
              provider,
            }
          : {
              mode,
              root,
              name: projectName,
              provider,
            },
      ),
    });

    if (payload.projectDetails) {
      upsertProject(payload.projectDetails);
      state.selectedProject = payload.projectDetails.path;
      syncSelectedSession(payload.sessionId || payload.projectDetails.activeSessionId || "", {
        preferCurrent: false,
      });
    } else {
      await refreshProjects();
    }

    void refreshProjectRoots().catch(() => {});
    renderAll();
  } catch (error) {
    if (optimisticState.rollbackProject) {
      replaceProject(optimisticState.rollbackProject);
    } else {
      removeProject(optimisticState.projectPath);
    }
    state.selectedProject = previousProjectPath;
    state.selectedSessionId = previousSessionId;
    syncSelectedProject(previousProjectPath, { preferCurrent: false });
    syncSelectedSession(previousSessionId, { preferCurrent: false });
    void refreshProjectRoots().catch(() => {});
    renderAll();
    showError(error);
  }
}

async function handleDispatch(event) {
  event.preventDefault();

  const project = state.selectedProject;
  const sessionId = state.selectedSessionId;
  const message = elements.messageInput.value.trim();
  const projectDetails = currentProject();
  const sessionDetails = currentSession();

  if (!project) {
    showError(new Error("Select a project."));
    return;
  }
  if (!sessionId) {
    showError(new Error("Select a session."));
    return;
  }
  if (!message) {
    showError(new Error("Write a message."));
    return;
  }

  if (pendingEntryForSession(project, sessionId)) {
    renderAll();
    return;
  }

  if (projectIsBusy(currentProject())) {
    showError(new Error("This project is busy."));
    return;
  }

  const entry = {
    id: makeEntryId(),
    projectPath: project,
    sessionId,
    projectLabel: projectDetails?.displayName || projectDetails?.slug || fallbackProjectLabel(project),
    sessionLabel: sessionOptionLabel(sessionDetails),
    message,
    requestId: "",
    status: "queued",
    sentAt: new Date().toISOString(),
    answeredAt: null,
    response: "",
    seenAt: null,
  };

  appendThreadEntry(entry);

  const optimisticProject = projectWithActiveSession(currentProject(), sessionId);
  if (optimisticProject) {
    replaceProject({
      ...optimisticProject,
      status: "running",
      sessions: optimisticProject.sessions.map((session) =>
        session.sessionId === sessionId ? { ...session, status: "running" } : session,
      ),
    });
  }

  state.dispatchPending = true;
  renderAll();

  try {
    const payload = await fetchJson("/v1/dispatch", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        project,
        sessionId,
        message,
        wait: false,
      }),
    });

    updateThreadEntry(entry.id, {
      requestId: String(payload.requestId || "").trim(),
    });

    elements.messageInput.value = "";
    if (
      currentModalThread()?.projectPath === project &&
      currentModalThread()?.sessionId === sessionId
    ) {
      void loadSessionHistory(project, sessionId, {
        reset: true,
        stickToBottom: true,
      });
    }
    void refreshProjects().catch(showError);
  } catch (error) {
    updateThreadEntry(entry.id, {
      status: "failed",
      answeredAt: new Date().toISOString(),
      response: error.message,
      seenAt: null,
    });
    showError(error);
  } finally {
    state.dispatchPending = false;
    renderAll();
  }
}

function bindEvents() {
  if (elements.headerCarouselButton) {
    elements.headerCarouselButton.addEventListener("click", () => {
      void advanceHeaderCarousel();
    });
  }
  elements.projectSummaryButton.addEventListener("click", () => {
    void openProjectSummary();
  });
  elements.projectAddButton.addEventListener("click", () => {
    void openProjectModal();
  });
  elements.dispatchForm.addEventListener("submit", handleDispatch);
  elements.detailBackdrop.addEventListener("click", closeSessionThread);
  elements.detailClose.addEventListener("click", closeSessionThread);
  elements.summaryBackdrop.addEventListener("click", closeProjectSummary);
  elements.summaryClose.addEventListener("click", closeProjectSummary);
  elements.summaryRefreshButton.addEventListener("click", () => {
    void requestNewProjectSummary();
  });
  elements.projectModalBackdrop.addEventListener("click", closeProjectModal);
  elements.projectModalClose.addEventListener("click", closeProjectModal);
  elements.projectModalForm.addEventListener("submit", handleProjectCreate);
  elements.sessionThreadButton.addEventListener("click", async () => {
    try {
      await openSessionThread();
    } catch (error) {
      showError(error);
    }
  });
  elements.queueToggle.addEventListener("click", () => {
    state.queueCollapsed = !state.queueCollapsed;
    persistQueueCollapsed();
    renderAll();
  });
  elements.detailHistoryList.addEventListener("scroll", async () => {
    const modalThread = currentModalThread();
    if (!modalThread || elements.detailHistoryList.scrollTop > 80) {
      return;
    }

    const historyState = historyStateFor(modalThread.projectPath, modalThread.sessionId);
    if (historyState.loading || !historyState.nextCursor) {
      return;
    }

    await loadSessionHistory(modalThread.projectPath, modalThread.sessionId, {
      appendOlder: true,
    });
  });

  elements.projectSelect.addEventListener("change", async (event) => {
    clearControlInteraction("project-select");
    state.selectedProject = event.target.value;
    syncSelectedSession("", { preferCurrent: false });
    renderAll();
    try {
      await refreshThreads();
    } catch (error) {
      showError(error);
    }
  });

  elements.sessionSelect.addEventListener("change", async (event) => {
    clearControlInteraction("session-select");
    try {
      await handleSessionSwitch(event.target.value);
    } catch (error) {
      showError(error);
    }
  });

  elements.projectRootSelect.addEventListener("change", (event) => {
    clearControlInteraction("project-modal");
    state.projectModalRoot = event.target.value;
    state.projectModalStatus = "";
    syncProjectRepoSelection("", { preferCurrent: false });
    renderAll();
  });

  elements.projectRepoSelect.addEventListener("change", (event) => {
    clearControlInteraction("project-modal");
    state.projectModalRepoPath = event.target.value;
    state.projectModalStatus = "";
    renderAll();
  });

  elements.projectNameInput.addEventListener("input", (event) => {
    markControlInteraction("project-modal");
    state.projectModalName = event.target.value;
    state.projectModalStatus = "";
    renderAll();
  });

  elements.projectProviderSelect.addEventListener("change", (event) => {
    clearControlInteraction("project-modal");
    state.projectModalProvider = event.target.value;
    state.projectModalStatus = "";
    renderAll();
  });

  [
    [elements.projectSelect, "project-select"],
    [elements.sessionSelect, "session-select"],
    [elements.projectRootSelect, "project-modal"],
    [elements.projectRepoSelect, "project-modal"],
    [elements.projectNameInput, "project-modal"],
    [elements.projectProviderSelect, "project-modal"],
  ].forEach(([node, target]) => {
    if (!node) {
      return;
    }
    node.addEventListener("pointerdown", () => {
      markControlInteraction(target);
    });
    node.addEventListener("focus", () => {
      markControlInteraction(target);
    });
    node.addEventListener("blur", () => {
      window.setTimeout(() => {
        clearControlInteraction(target);
        renderAll();
      }, 120);
    });
  });

  [elements.projectModeExisting, elements.projectModeNew].forEach((button) => {
    button.addEventListener("click", () => {
      setProjectModalMode(button.dataset.mode);
    });
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && currentModalThread()) {
      closeSessionThread();
      return;
    }
    if (event.key === "Escape" && state.summaryModalProject) {
      closeProjectSummary();
      return;
    }
    if (event.key === "Escape" && state.projectModalOpen) {
      closeProjectModal();
    }
  });
}

async function boot() {
  bindEvents();
  void initHeaderCarousel();
  restoreThreadEntries();
  restoreQueueCollapsed();
  restoreCachedProjects();
  renderAll();

  try {
    await refreshProjects();
  } catch (error) {
    showError(error);
  }

  window.setInterval(async () => {
    try {
      await refreshProjects();
    } catch (_error) {
      // Keep the current view on transient failures.
    }
  }, autoRefreshMs);
}

boot();
