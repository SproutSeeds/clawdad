const state = {
  projects: [],
  projectRoots: [],
  selectedProject: "",
  selectedSessionId: "",
  sessionImportModalProject: "",
  sessionImportPendingId: "",
  sessionTitleModalProject: "",
  sessionTitleModalSessionId: "",
  sessionTitleDraft: "",
  sessionTitleConfirmRemove: false,
  sessionTitlePending: false,
  sessionTitleError: "",
  pendingSessionRenames: {},
  importableSessionsByProject: {},
  threadEntries: [],
  modalThread: null,
  summaryModalProject: "",
  projectSummaries: {},
  artifactModalProject: "",
  artifactsByProject: {},
  artifactDownloadPendingId: "",
  artifactRefreshPromises: {},
  artifactShelfCollapsed: false,
  delegateModalProject: "",
  delegatesByProject: {},
  delegateSelectedRunIds: {},
  delegateLogModes: {},
  delegateCarouselSlide: "runs",
  delegateBriefDraft: "",
  delegateBriefDirty: false,
  delegateBriefPending: false,
  delegatePlanPending: false,
  delegateRunPending: false,
  delegateRunSummaryPending: false,
  delegateFeedPending: false,
  projectModalOpen: false,
  projectModalMode: "existing",
  projectModalRoot: "",
  projectModalRepoPath: "",
  projectModalName: "",
  projectModalProvider: "codex",
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
  summaryRefreshPromise: null,
  delegateRefreshPromise: null,
  historyPrefetchPromises: {},
  foregroundRefreshPromise: null,
  lastForegroundRefreshAt: 0,
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
  sessionImportButton: document.querySelector("#sessionImportButton"),
  sessionImportOrb: document.querySelector("#sessionImportOrb"),
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
  projectDelegateButton: document.querySelector("#projectDelegateButton"),
  projectArtifactsButton: document.querySelector("#projectArtifactsButton"),
  projectArtifactsOrb: document.querySelector("#projectArtifactsOrb"),
  artifactShelf: document.querySelector("#artifactShelf"),
  artifactShelfTitle: document.querySelector("#artifactShelfTitle"),
  artifactShelfMeta: document.querySelector("#artifactShelfMeta"),
  artifactShelfOpenButton: document.querySelector("#artifactShelfOpenButton"),
  artifactShelfToggle: document.querySelector("#artifactShelfToggle"),
  artifactShelfBody: document.querySelector("#artifactShelfBody"),
  artifactShelfList: document.querySelector("#artifactShelfList"),
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
  sessionRenameButton: document.querySelector("#sessionRenameButton"),
  sessionImportModal: document.querySelector("#sessionImportModal"),
  sessionImportBackdrop: document.querySelector("#sessionImportBackdrop"),
  sessionImportClose: document.querySelector("#sessionImportClose"),
  sessionImportProject: document.querySelector("#sessionImportProject"),
  sessionImportState: document.querySelector("#sessionImportState"),
  sessionImportList: document.querySelector("#sessionImportList"),
  sessionTitleModal: document.querySelector("#sessionTitleModal"),
  sessionTitleBackdrop: document.querySelector("#sessionTitleBackdrop"),
  sessionTitleClose: document.querySelector("#sessionTitleClose"),
  sessionTitleForm: document.querySelector("#sessionTitleForm"),
  sessionTitleProject: document.querySelector("#sessionTitleProject"),
  sessionTitleSession: document.querySelector("#sessionTitleSession"),
  sessionTitleState: document.querySelector("#sessionTitleState"),
  sessionTitleInput: document.querySelector("#sessionTitleInput"),
  sessionTitleRemoveButton: document.querySelector("#sessionTitleRemoveButton"),
  sessionTitleSaveButton: document.querySelector("#sessionTitleSaveButton"),
  summaryModal: document.querySelector("#summaryModal"),
  summaryBackdrop: document.querySelector("#summaryBackdrop"),
  summaryClose: document.querySelector("#summaryClose"),
  summaryProject: document.querySelector("#summaryProject"),
  summarySession: document.querySelector("#summarySession"),
  summaryState: document.querySelector("#summaryState"),
  summaryList: document.querySelector("#summaryList"),
  summaryRefreshButton: document.querySelector("#summaryRefreshButton"),
  artifactsModal: document.querySelector("#artifactsModal"),
  artifactsBackdrop: document.querySelector("#artifactsBackdrop"),
  artifactsClose: document.querySelector("#artifactsClose"),
  artifactsProject: document.querySelector("#artifactsProject"),
  artifactsRoot: document.querySelector("#artifactsRoot"),
  artifactsState: document.querySelector("#artifactsState"),
  artifactsList: document.querySelector("#artifactsList"),
  artifactsRefreshButton: document.querySelector("#artifactsRefreshButton"),
  delegateModal: document.querySelector("#delegateModal"),
  delegateBackdrop: document.querySelector("#delegateBackdrop"),
  delegateClose: document.querySelector("#delegateClose"),
  delegateProject: document.querySelector("#delegateProject"),
  delegateSession: document.querySelector("#delegateSession"),
  delegateState: document.querySelector("#delegateState"),
  delegateOverview: document.querySelector("#delegateOverview"),
  delegateBriefInput: document.querySelector("#delegateBriefInput"),
  delegateSaveButton: document.querySelector("#delegateSaveButton"),
  delegatePlanButton: document.querySelector("#delegatePlanButton"),
  delegateRunButton: document.querySelector("#delegateRunButton"),
  delegateSummaryButton: document.querySelector("#delegateSummaryButton"),
  delegateCarouselPrev: document.querySelector("#delegateCarouselPrev"),
  delegateCarouselNext: document.querySelector("#delegateCarouselNext"),
  delegateCarouselTitle: document.querySelector("#delegateCarouselTitle"),
  delegateCarouselMeta: document.querySelector("#delegateCarouselMeta"),
  delegateCarouselTabs: document.querySelector("#delegateCarouselTabs"),
  delegateRunsPanel: document.querySelector("#delegateRunsPanel"),
  delegateRunLogPanel: document.querySelector("#delegateRunLogPanel"),
  delegateReviewPanel: document.querySelector("#delegateReviewPanel"),
  delegateBriefPanel: document.querySelector("#delegateBriefPanel"),
  delegatePlanPanel: document.querySelector("#delegatePlanPanel"),
  delegateSummaryPanel: document.querySelector("#delegateSummaryPanel"),
  delegateRunCardList: document.querySelector("#delegateRunCardList"),
  delegateRunList: document.querySelector("#delegateRunList"),
  delegateReviewList: document.querySelector("#delegateReviewList"),
  delegateSummaryList: document.querySelector("#delegateSummaryList"),
  delegatePlanList: document.querySelector("#delegatePlanList"),
};

const autoRefreshMs = 15000;
const foregroundRefreshDebounceMs = 1500;
const importableSessionsCacheMs = 30000;
const projectCacheKey = "clawdad-project-catalog-v4";
const threadCacheKey = "clawdad-thread-log-v1";
const queueCollapsedKey = "clawdad-queue-collapsed-v1";
const artifactShelfCollapsedKey = "clawdad-artifact-shelf-collapsed-v1";
const queuedDispatchGraceMs = 15000;
// Dispatch startup can lag behind refreshes; do not mark optimistic queue cards failed too early.
const queuedDispatchAttachGraceMs = 2 * 60 * 1000;
const historyDuplicateWindowMs = queuedDispatchAttachGraceMs;
const copiedFeedbackMs = 1400;
const historyPageSize = 20;
const historyPrefetchFreshMs = 5 * 60 * 1000;
const historyPrefetchEntryLimit = 8;
const headerCarouselIntervalMs = 11000;
const headerCarouselVersion = "20260406m";
const headerCatchphraseSwapMs = 150;
const featuredProjectRules = Object.freeze({
  "global-mind": {
    displayName: "Global Mind",
    accent: "gold",
    role: "global-mind",
  },
});
const pendingSessionPhrases = [
  "loading up a fresh beaux",
  "stirrin' a new bayou lane",
  "cookin' up a clean little thread",
  "pourin' a fresh clawdad session",
  "settin' the table for a new beaux",
  "spinnin' up a new swamp-side lane",
];
const processingStatusPhrases = [
  "stirrin' dat roux",
  "workin' dat boil",
  "shakin' de skillet",
  "simmerin' somethin' nice",
  "lagniappe in motion",
  "bayou gears turnin'",
  "mudbug math brewin'",
  "butter gettin' warm",
  "coaxin' de craws",
  "lettin' de pot talk",
  "slow rollin' dat spice",
  "swamp steam risin'",
  "cher, it's cookin'",
  "stayin' on de flame",
  "de claws are clackin'",
  "gumbofyin' de plan",
  "marinatin' de answer",
  "boilin' up de next bit",
  "runnin' de bayou lane",
  "heatin' de cast iron",
  "cajun gears hummin'",
  "lettin' it steep, cher",
  "de broth is bubblin'",
  "seasonin' de thread",
  "workin' dat back burner",
  "brewin' de beignet logic",
  "bayou sparks flyin'",
  "mud stove hummin'",
  "de pot got opinions",
  "roux gettin' darker",
  "coastin' on hot butter",
  "fishin' for de finish",
  "swamp smoke curlin'",
  "de skillet's singin'",
  "rakin' de coals",
  "catfish current flowin'",
  "de dock lights blinkin'",
  "stitchin' de net tight",
  "pinchin' de details",
  "butter in de pan",
  "de bayou got traction",
  "saucin' up de answer",
  "lettin' de craw think",
  "de kettle got momentum",
  "de flame's holdin'",
  "hush now, it's brewin'",
  "scootin' through de reeds",
  "de spice rack's workin'",
  "greasin' de gears, cher",
  "cajun butter meltin'",
];
const delegateCarouselSlides = Object.freeze([
  { id: "runs", label: "History" },
  { id: "log", label: "Log" },
  { id: "review", label: "Review" },
  { id: "brief", label: "Brief" },
]);
const delegateAutoIcon = "\u221e";
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
let detailHistoryRenderSnapshot = null;
let delegateRunRenderSnapshot = null;
const pendingSessionCycle = {
  order: [],
  cursor: 0,
};
const processingPhraseCycle = {
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
const fullDateTimeFormatter = new Intl.DateTimeFormat([], {
  month: "short",
  day: "numeric",
  year: "numeric",
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

function featuredProjectMeta(projectPath, fallbackDisplayName = "") {
  const slug = basenameFromPath(projectPath);
  const rule = featuredProjectRules[slug.toLowerCase()] || null;
  return {
    slug,
    displayName: rule?.displayName || fallbackDisplayName || slug,
    featured: Boolean(rule),
    featuredAccent: rule?.accent || "",
    specialRole: rule?.role || "",
  };
}

function delegateCatalogStatusIsLive(status) {
  const normalizedState = String(status?.state || "").trim().toLowerCase();
  return normalizedState === "planning" || normalizedState === "running";
}

function projectDelegateStatus(project) {
  if (!project?.path) {
    return null;
  }

  const liveState = delegateStateFor(project.path)?.status || null;
  if (liveState) {
    const normalizedLiveState = normalizeDelegateStatus(liveState);
    return normalizedLiveState.state === "idle" ? null : normalizedLiveState;
  }

  if (project.delegateStatus) {
    const normalizedProjectStatus = normalizeDelegateStatus(project.delegateStatus);
    return normalizedProjectStatus.state === "idle" ? null : normalizedProjectStatus;
  }

  return null;
}

function projectHasLiveDelegate(project) {
  return delegateCatalogStatusIsLive(projectDelegateStatus(project));
}

function projectDelegateStatusKey(project) {
  const status = projectDelegateStatus(project);
  if (!status) {
    return "";
  }
  return [
    status.state,
    status.runId || "",
    status.activeStep || 0,
    status.stepCount || 0,
    Number(Boolean(status.pauseRequested)),
  ].join(":");
}

function compareProjects(left, right) {
  const leftFeatured = Boolean(left?.featured);
  const rightFeatured = Boolean(right?.featured);
  if (leftFeatured !== rightFeatured) {
    return leftFeatured ? -1 : 1;
  }

  const leftLive = projectHasLiveDelegate(left);
  const rightLive = projectHasLiveDelegate(right);
  if (leftLive !== rightLive) {
    return leftLive ? -1 : 1;
  }

  const leftName = String(left?.displayName || left?.slug || left?.path || "");
  const rightName = String(right?.displayName || right?.slug || right?.path || "");
  return leftName.localeCompare(rightName);
}

function hydrateProjectVisuals(project) {
  if (!project?.path) {
    return project;
  }

  const visualMeta = featuredProjectMeta(
    project.path,
    String(project.displayName || project.slug || basenameFromPath(project.path) || ""),
  );
  return {
    ...project,
    slug: project.slug || visualMeta.slug,
    displayName: visualMeta.displayName,
    featured: visualMeta.featured,
    featuredAccent: visualMeta.featuredAccent,
    specialRole: visualMeta.specialRole,
  };
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

function resetProcessingPhraseCycle(previousPhraseIndex = -1) {
  const order = shuffleInPlace(
    Array.from({ length: processingStatusPhrases.length }, (_value, index) => index),
  );

  if (
    order.length > 1 &&
    previousPhraseIndex >= 0 &&
    order[0] === previousPhraseIndex
  ) {
    const swapIndex = 1 + randomInteger(order.length - 1);
    [order[0], order[swapIndex]] = [order[swapIndex], order[0]];
  }

  processingPhraseCycle.order = order;
  processingPhraseCycle.cursor = 0;
}

function currentProcessingPhrase() {
  if (processingStatusPhrases.length === 0) {
    return "stirrin' dat roux";
  }

  if (
    processingPhraseCycle.order.length === 0 ||
    processingPhraseCycle.cursor < 0 ||
    processingPhraseCycle.cursor >= processingPhraseCycle.order.length
  ) {
    resetProcessingPhraseCycle();
  }

  return (
    processingStatusPhrases[processingPhraseCycle.order[processingPhraseCycle.cursor]] ||
    processingStatusPhrases[0]
  );
}

function advanceProcessingPhraseCycle() {
  if (processingStatusPhrases.length === 0) {
    return;
  }

  const previousPhraseIndex =
    processingPhraseCycle.order[processingPhraseCycle.cursor] ?? -1;
  processingPhraseCycle.cursor += 1;

  if (processingPhraseCycle.cursor >= processingPhraseCycle.order.length) {
    resetProcessingPhraseCycle(previousPhraseIndex);
  }
}

function processingCopyActive() {
  if (state.threadEntries.some((entry) => entry.status === "queued")) {
    return true;
  }

  if (state.projects.some((project) => projectIsBusy(project))) {
    return true;
  }

  return currentThreadEntries().some((entry) => entry.status === "queued");
}

function renderProcessingCopy() {
  if (!processingCopyActive()) {
    return;
  }

  renderQueueList();
  updateMailboxState();
  updateSendAvailability();
  if (currentModalThread()) {
    renderModal();
  }
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
  const dateDay = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dayDelta = Math.round((today - dateDay) / (24 * 60 * 60 * 1000));
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  if (sameDay) {
    return `Today ${timeFormatter.format(date)}`;
  }
  if (dayDelta === 1) {
    return `Yesterday ${timeFormatter.format(date)}`;
  }
  if (date.getFullYear() === now.getFullYear()) {
    return dateTimeFormatter.format(date);
  }
  return fullDateTimeFormatter.format(date);
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

function cleanSessionTitle(rawTitle, provider) {
  const title = String(rawTitle || "").trim();
  const normalizedProvider = providerLabel(provider);
  if (!title) {
    return normalizedProvider;
  }

  const providerSuffixPattern = new RegExp(`\\s*\\(${normalizedProvider}\\)$`, "i");
  return title.replace(providerSuffixPattern, "").trim() || normalizedProvider;
}

function sessionFingerprint(sessionId) {
  const value = String(sessionId || "").trim();
  if (!value) {
    return "unknown";
  }
  return value.length <= 4 ? value : `…${value.slice(-4)}`;
}

function sessionFixedSuffix(session) {
  return `${providerLabel(session?.provider)} • ${sessionFingerprint(session?.sessionId)}`;
}

function sessionRenameKey(projectPath, sessionId) {
  return `${String(projectPath || "").trim()}::${String(sessionId || "").trim()}`;
}

function pendingSessionRename(projectPath, sessionId) {
  if (!projectPath || !sessionId) {
    return null;
  }

  return state.pendingSessionRenames[sessionRenameKey(projectPath, sessionId)] || null;
}

function setPendingSessionRename(projectPath, sessionId, renameState = null) {
  if (!projectPath || !sessionId) {
    return;
  }

  const key = sessionRenameKey(projectPath, sessionId);
  if (renameState) {
    state.pendingSessionRenames[key] = {
      ...renameState,
    };
    return;
  }

  delete state.pendingSessionRenames[key];
}

function sessionDisplayTitle(session, projectPath = "") {
  const resolvedProjectPath = String(session?.path || projectPath || "").trim();
  const pendingRename = pendingSessionRename(resolvedProjectPath, session?.sessionId);
  return cleanSessionTitle(pendingRename?.title || session?.slug, session?.provider);
}

function sessionRenamePending(projectPath, sessionId) {
  return Boolean(pendingSessionRename(projectPath, sessionId));
}

function sessionOptionLabel(session, projectPath = "") {
  if (session?.pendingCreation && session?.loadingLabel) {
    return session.loadingLabel;
  }
  const title = sessionDisplayTitle(session, projectPath);
  return `${title} • ${sessionFixedSuffix(session)}`;
}

function importableSessionLabel(session) {
  const title = cleanSessionTitle(session?.titleHint, "session");
  return `${title} • ${providerLabel(session?.provider)} • ${sessionFingerprint(session?.sessionId)}`;
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

function currentSessionTitleTarget() {
  const project = projectByPath(state.sessionTitleModalProject);
  const session =
    project?.sessions?.find((item) => item.sessionId === state.sessionTitleModalSessionId) || null;
  return {
    project: project || null,
    session: session || null,
  };
}

function currentModalThread() {
  return state.modalThread || null;
}

function currentSummaryProject() {
  return projectByPath(state.summaryModalProject) || null;
}

function currentArtifactsProject() {
  return projectByPath(state.artifactModalProject) || null;
}

function currentDelegateProject() {
  return projectByPath(state.delegateModalProject) || null;
}

function currentProjectRoot() {
  return state.projectRoots.find((root) => root.path === state.projectModalRoot) || null;
}

function currentRootRepos() {
  return Array.isArray(currentProjectRoot()?.repos) ? currentProjectRoot().repos : [];
}

function currentSessionImportProject() {
  return projectByPath(state.sessionImportModalProject) || null;
}

function importableSessionsStateFor(projectPath) {
  return (
    state.importableSessionsByProject[String(projectPath || "").trim()] || {
      items: [],
      loading: false,
      initialized: false,
      loadedAt: 0,
      error: "",
      promise: null,
    }
  );
}

function setImportableSessionsState(projectPath, nextState = {}) {
  const normalizedProjectPath = String(projectPath || "").trim();
  if (!normalizedProjectPath) {
    return;
  }

  state.importableSessionsByProject[normalizedProjectPath] = {
    ...importableSessionsStateFor(normalizedProjectPath),
    ...nextState,
  };
}

function clearImportableSessionsState(projectPath = "") {
  const normalizedProjectPath = String(projectPath || "").trim();
  if (!normalizedProjectPath) {
    return;
  }
  delete state.importableSessionsByProject[normalizedProjectPath];
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
      prefetchedAt: 0,
      error: "",
    }
  );
}

function currentModalThreadKey() {
  const modalThread = currentModalThread();
  if (!modalThread?.projectPath || !modalThread?.sessionId) {
    return "";
  }
  return historyKey(modalThread.projectPath, modalThread.sessionId);
}

function historyRenderSignature(historyState) {
  const itemsSignature = Array.isArray(historyState?.items)
    ? historyState.items
        .map((entry) =>
          [
            String(entry?.requestId || ""),
            String(entry?.status || ""),
            String(entry?.answeredAt || ""),
            String(entry?.seenAt || ""),
            String(entry?.message || "").length,
            String(entry?.response || "").length,
          ].join("~"),
        )
        .join("|")
    : "";

  return JSON.stringify({
    error: String(historyState?.error || ""),
    nextCursor: String(historyState?.nextCursor || ""),
    initialized: Boolean(historyState?.initialized),
    items: itemsSignature,
  });
}

function captureDetailHistorySnapshot(threadKey, mode = "smart") {
  if (!threadKey || !elements.detailHistoryList) {
    return null;
  }

  const container = elements.detailHistoryList;
  const { scrollTop, scrollHeight, clientHeight } = container;
  const containerRect = container.getBoundingClientRect();
  const anchor = Array.from(container.querySelectorAll("[data-history-anchor]"))
    .find((node) => {
      const rect = node.getBoundingClientRect();
      return rect.bottom > containerRect.top + 8 && rect.top < containerRect.bottom - 8;
    });
  const anchorRect = anchor?.getBoundingClientRect();

  return {
    threadKey,
    mode,
    previousTop: scrollTop,
    previousHeight: scrollHeight,
    nearBottom: scrollHeight - clientHeight - scrollTop < 72,
    anchorKey: anchor?.dataset?.historyAnchor || "",
    anchorOffset: anchorRect ? anchorRect.top - containerRect.top : 0,
  };
}

function queueDetailHistorySnapshot(snapshot) {
  detailHistoryRenderSnapshot = snapshot || null;
}

function applyDetailHistorySnapshot(snapshot) {
  if (!snapshot || !elements.detailHistoryList) {
    return;
  }

  window.requestAnimationFrame(() => {
    if (currentModalThreadKey() !== snapshot.threadKey) {
      return;
    }

    if (snapshot.mode === "prepend-older") {
      elements.detailHistoryList.scrollTop =
        elements.detailHistoryList.scrollHeight - snapshot.previousHeight + snapshot.previousTop;
      return;
    }

    if (snapshot.mode === "bottom" || snapshot.nearBottom) {
      elements.detailHistoryList.scrollTop = elements.detailHistoryList.scrollHeight;
      return;
    }

    if (snapshot.anchorKey) {
      const anchoredNode = Array.from(
        elements.detailHistoryList.querySelectorAll("[data-history-anchor]"),
      ).find((node) => node.dataset?.historyAnchor === snapshot.anchorKey);
      if (anchoredNode) {
        const containerRect = elements.detailHistoryList.getBoundingClientRect();
        const anchorRect = anchoredNode.getBoundingClientRect();
        elements.detailHistoryList.scrollTop += anchorRect.top - containerRect.top - snapshot.anchorOffset;
        return;
      }
    }

    elements.detailHistoryList.scrollTop = snapshot.previousTop;
  });
}

function delegateRunKey(projectPath, runId) {
  return `${String(projectPath || "").trim()}::${String(runId || "").trim()}`;
}

function delegateCarouselSlideIndex(slideId = state.delegateCarouselSlide) {
  const index = delegateCarouselSlides.findIndex((slide) => slide.id === slideId);
  return index >= 0 ? index : 0;
}

function setDelegateCarouselSlide(slideId) {
  const nextSlide = delegateCarouselSlides.find((slide) => slide.id === slideId)?.id || "runs";
  state.delegateCarouselSlide = nextSlide;
  renderAll();
}

function advanceDelegateCarousel(direction) {
  const currentIndex = delegateCarouselSlideIndex();
  const nextIndex =
    (currentIndex + direction + delegateCarouselSlides.length) % delegateCarouselSlides.length;
  setDelegateCarouselSlide(delegateCarouselSlides[nextIndex].id);
}

function selectedDelegateRunId(projectPath, delegateState = delegateStateFor(projectPath)) {
  return (
    String(state.delegateSelectedRunIds[projectPath] || "").trim() ||
    String(delegateState?.status?.runId || "").trim() ||
    String(delegateState?.runLog?.runId || "").trim() ||
    String(delegateState?.latestRunSummarySnapshot?.runId || "").trim() ||
    String(delegateState?.runSummarySnapshots?.find((snapshot) => snapshot?.runId)?.runId || "").trim()
  );
}

function delegateLogModeFor(projectPath) {
  const mode = String(state.delegateLogModes[projectPath] || "").trim();
  return mode === "steps" ? "steps" : "live";
}

function setDelegateLogMode(projectPath, mode) {
  const nextMode = mode === "steps" ? "steps" : "live";
  if (!projectPath || delegateLogModeFor(projectPath) === nextMode) {
    return;
  }
  state.delegateLogModes[projectPath] = nextMode;
  delegateRunRenderSnapshot = null;
  renderAll();
}

function delegateRunRenderSignature(runLog, { logMode = "live" } = {}) {
  const loadingStateChangesLayout = Boolean(runLog?.loading && !runLog?.initialized);
  const eventsSignature = Array.isArray(runLog?.events)
    ? runLog.events
        .map((event) =>
          [
            String(event?.id || ""),
            String(event?.at || ""),
            String(event?.type || ""),
            String(event?.step || ""),
            String(event?.state || ""),
            String(event?.summary || "").length,
            String(event?.text || "").length,
            String(event?.error || "").length,
          ].join("~"),
        )
        .join("|")
    : "";

  return JSON.stringify({
    logMode,
    error: String(runLog?.error || ""),
    loading: loadingStateChangesLayout,
    initialized: Boolean(runLog?.initialized),
    nextCursor: String(runLog?.nextCursor || ""),
    total: Number(runLog?.total || 0),
    events: eventsSignature,
  });
}

function delegateRunScrollContainer() {
  return elements.delegateRunLogPanel || elements.delegateRunList;
}

function captureDelegateRunSnapshot(runKey, mode = "smart") {
  if (!runKey || !elements.delegateRunList) {
    return null;
  }

  const container = delegateRunScrollContainer();
  const { scrollTop, scrollHeight, clientHeight } = container;
  const containerRect = container.getBoundingClientRect();
  const anchor = Array.from(container.querySelectorAll("[data-delegate-log-anchor]"))
    .find((node) => {
      const rect = node.getBoundingClientRect();
      return rect.bottom > containerRect.top + 8 && rect.top < containerRect.bottom - 8;
    });
  const anchorRect = anchor?.getBoundingClientRect();

  return {
    runKey,
    mode,
    previousTop: scrollTop,
    previousHeight: scrollHeight,
    nearBottom: scrollHeight - clientHeight - scrollTop < 72,
    anchorKey: anchor?.dataset?.delegateLogAnchor || "",
    anchorOffset: anchorRect ? anchorRect.top - containerRect.top : 0,
  };
}

function applyDelegateRunSnapshot(snapshot) {
  if (!snapshot || !elements.delegateRunList) {
    return;
  }

  window.requestAnimationFrame(() => {
    const container = delegateRunScrollContainer();
    const project = currentDelegateProject();
    const runId = delegateStateFor(project?.path || "").runLog?.runId || "";
    if (delegateRunKey(project?.path || "", runId) !== snapshot.runKey) {
      return;
    }

    if (snapshot.mode === "bottom" || snapshot.nearBottom) {
      container.scrollTop = container.scrollHeight;
      return;
    }

    if (snapshot.anchorKey) {
      const anchoredNode = Array.from(
        container.querySelectorAll("[data-delegate-log-anchor]"),
      ).find((node) => node.dataset?.delegateLogAnchor === snapshot.anchorKey);
      if (anchoredNode) {
        const containerRect = container.getBoundingClientRect();
        const anchorRect = anchoredNode.getBoundingClientRect();
        container.scrollTop += anchorRect.top - containerRect.top - snapshot.anchorOffset;
        return;
      }
    }

    container.scrollTop = snapshot.previousTop;
  });
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
      summaryStatus: null,
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

function artifactsStateFor(projectPath) {
  return (
    state.artifactsByProject[projectPath] || {
      items: [],
      artifactRoot: "",
      loading: false,
      initialized: false,
      error: "",
    }
  );
}

function setArtifactsState(projectPath, nextState) {
  state.artifactsByProject[projectPath] = {
    ...artifactsStateFor(projectPath),
    ...nextState,
  };
}

function delegateStateFor(projectPath) {
  return (
    state.delegatesByProject[projectPath] || {
      config: null,
      brief: "",
      status: null,
      delegateSession: null,
      latestPlanSnapshot: null,
      planSnapshots: [],
      runList: [],
      latestRunSummarySnapshot: null,
      runSummarySnapshots: [],
      runLog: {
        runId: "",
        events: [],
        nextCursor: "0",
        total: 0,
        loading: false,
        initialized: false,
        error: "",
      },
      feed: {
        cards: [],
        events: [],
        scan: null,
        loading: false,
        initialized: false,
        error: "",
      },
      loading: false,
      initialized: false,
      error: "",
    }
  );
}

function setDelegateState(projectPath, nextState) {
  state.delegatesByProject[projectPath] = {
    ...delegateStateFor(projectPath),
    ...nextState,
  };
}

function delegatePayloadState(projectPath, payload = {}, { briefFallback = "" } = {}) {
  const existing = delegateStateFor(projectPath);
  const hasBrief = Object.prototype.hasOwnProperty.call(payload, "brief");
  return {
    loading: false,
    initialized: true,
    error: "",
    config: payload.config || existing.config || null,
    brief: hasBrief ? String(payload.brief || "") : String(briefFallback || existing.brief || ""),
    status: payload.status ? normalizeDelegateStatus(payload.status) : existing.status,
    delegateSession: payload.delegateSession || existing.delegateSession,
    latestPlanSnapshot: payload.latestPlanSnapshot
      ? normalizeDelegatePlanSnapshot(payload.latestPlanSnapshot)
      : existing.latestPlanSnapshot,
    planSnapshots: Array.isArray(payload.planSnapshots)
      ? payload.planSnapshots.map(normalizeDelegatePlanSnapshot)
      : existing.planSnapshots,
    runList: Array.isArray(payload.delegateRuns)
      ? payload.delegateRuns.map(normalizeDelegateRunInfo)
      : existing.runList,
    latestRunSummarySnapshot: payload.latestRunSummarySnapshot
      ? normalizeDelegateRunSummarySnapshot(payload.latestRunSummarySnapshot)
      : existing.latestRunSummarySnapshot,
    runSummarySnapshots: Array.isArray(payload.runSummarySnapshots)
      ? payload.runSummarySnapshots.map(normalizeDelegateRunSummarySnapshot)
      : existing.runSummarySnapshots,
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

function persistArtifactShelfCollapsed() {
  try {
    localStorage.setItem(artifactShelfCollapsedKey, JSON.stringify(state.artifactShelfCollapsed));
  } catch (_error) {
    // Ignore storage failures.
  }
}

function restoreArtifactShelfCollapsed() {
  try {
    state.artifactShelfCollapsed = JSON.parse(localStorage.getItem(artifactShelfCollapsedKey) || "false") === true;
  } catch (_error) {
    state.artifactShelfCollapsed = false;
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
  return sessionOptionLabel(sessionForEntry(entry), entry?.projectPath || "");
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

function historyItemStatusRank(status) {
  const normalized = String(status || "").trim().toLowerCase();
  return { queued: 1, failed: 2, answered: 3 }[normalized] || 0;
}

function isSyntheticHistoryRequestId(value) {
  const requestId = String(value || "").trim();
  return requestId.startsWith("codex:") || requestId.startsWith("chimera:");
}

function stripClawdadHistoryHandoff(value) {
  return String(value || "")
    .replace(/\s*\[Clawdad artifact handoff:[\s\S]*?\]\s*$/u, "")
    .trim();
}

function comparableHistoryMessage(value) {
  return stripClawdadHistoryHandoff(value).replace(/\s+/g, " ").trim();
}

function isUnattachedLocalHistoryItem(item) {
  return (
    String(item?.status || "").trim().toLowerCase() === "queued" &&
    !String(item?.response || "").trim()
  );
}

function historyItemsLikelySame(left, right) {
  const leftRequestId = String(left?.requestId || "").trim();
  const rightRequestId = String(right?.requestId || "").trim();
  if (leftRequestId && rightRequestId && leftRequestId === rightRequestId) {
    return true;
  }

  if (
    leftRequestId &&
    rightRequestId &&
    !isSyntheticHistoryRequestId(leftRequestId) &&
    !isSyntheticHistoryRequestId(rightRequestId) &&
    !isUnattachedLocalHistoryItem(left) &&
    !isUnattachedLocalHistoryItem(right)
  ) {
    return false;
  }

  const leftSessionId = String(left?.sessionId || "").trim();
  const rightSessionId = String(right?.sessionId || "").trim();
  if (leftSessionId && rightSessionId && leftSessionId !== rightSessionId) {
    return false;
  }

  const leftMessage = comparableHistoryMessage(left?.message);
  const rightMessage = comparableHistoryMessage(right?.message);
  if (!leftMessage || leftMessage !== rightMessage) {
    return false;
  }

  const leftSentAt = new Date(left?.sentAt || 0).getTime();
  const rightSentAt = new Date(right?.sentAt || 0).getTime();
  if (!Number.isFinite(leftSentAt) || !Number.isFinite(rightSentAt)) {
    return false;
  }

  return Math.abs(leftSentAt - rightSentAt) <= historyDuplicateWindowMs;
}

function mergeHistoryItem(existing, incoming) {
  const existingRank = historyItemStatusRank(existing?.status);
  const incomingRank = historyItemStatusRank(incoming?.status);
  const status = incomingRank >= existingRank ? incoming?.status : existing?.status;
  const firstNonEmpty = (...values) => {
    for (const value of values) {
      const normalized = String(value || "").trim();
      if (normalized) {
        return normalized;
      }
    }
    return "";
  };
  const response =
    String(incoming?.response || "").trim() ||
    String(existing?.response || "");
  const requestId =
    String(incoming?.requestId || "").trim() ||
    String(existing?.requestId || "").trim();
  const projectPath = firstNonEmpty(incoming?.projectPath, existing?.projectPath);
  const sessionId = firstNonEmpty(incoming?.sessionId, existing?.sessionId);
  const sentAt = firstNonEmpty(existing?.sentAt, incoming?.sentAt);
  const answeredAt = firstNonEmpty(incoming?.answeredAt, existing?.answeredAt);
  const incomingMessage = String(incoming?.message || "");
  const existingMessage = String(existing?.message || "");

  return {
    ...existing,
    ...incoming,
    requestId: requestId || makeEntryId(),
    projectPath,
    sessionId,
    projectLabel:
      firstNonEmpty(incoming?.projectLabel, existing?.projectLabel) ||
      fallbackProjectLabel(projectPath),
    sessionLabel: firstNonEmpty(incoming?.sessionLabel, existing?.sessionLabel),
    provider: firstNonEmpty(incoming?.provider, existing?.provider) || "session",
    message: incomingMessage.trim() ? incomingMessage : existingMessage,
    sentAt: sentAt || new Date().toISOString(),
    answeredAt: answeredAt || null,
    status: status || incoming?.status || existing?.status || "queued",
    response,
    exitCode:
      typeof incoming?.exitCode === "number"
        ? incoming.exitCode
        : typeof existing?.exitCode === "number"
          ? existing.exitCode
          : null,
    seenAt:
      String(existing?.seenAt || "").trim() ||
      String(incoming?.seenAt || "").trim() ||
      null,
  };
}

function mergeHistoryItems(existingItems = [], incomingItems = []) {
  const merged = [];

  for (const rawItem of [...existingItems, ...incomingItems]) {
    const item = normalizeHistoryItem(rawItem);
    const matchIndex = merged.findIndex((candidate) => historyItemsLikelySame(candidate, item));
    if (matchIndex >= 0) {
      merged[matchIndex] = mergeHistoryItem(merged[matchIndex], item);
    } else {
      merged.push(item);
    }
  }

  return merged.sort((left, right) => {
    const leftMs = new Date(left.sentAt || 0).getTime();
    const rightMs = new Date(right.sentAt || 0).getTime();
    return (Number.isFinite(leftMs) ? leftMs : 0) - (Number.isFinite(rightMs) ? rightMs : 0);
  });
}

function historyItemFromThreadEntry(entry) {
  if (!entry?.projectPath || !entry?.sessionId) {
    return null;
  }

  const item = normalizeHistoryItem({
    ...entry,
    projectPath: entry.projectPath,
    sessionId: entry.sessionId,
    sessionLabel: entry.sessionLabel || entrySessionLabel(entry),
  });

  return {
    ...item,
    requestId: String(entry.requestId || item.requestId || "").trim() || item.requestId,
    seenAt: String(entry.seenAt || "").trim() || null,
  };
}

function hydrateHistoryFromThreadEntry(entry) {
  const item = historyItemFromThreadEntry(entry);
  if (!item) {
    return;
  }

  const existing = historyStateFor(item.projectPath, item.sessionId);
  setHistoryState(item.projectPath, item.sessionId, {
    items: mergeHistoryItems(existing.items, [item]),
    nextCursor: existing.nextCursor || "0",
    initialized: true,
    error: existing.error || "",
  });
}

function hydrateReturnedThreadEntries({ prefetch = false } = {}) {
  const returnedEntries = state.threadEntries.filter(entryHasReturned);
  for (const entry of returnedEntries) {
    hydrateHistoryFromThreadEntry(entry);
  }

  if (!prefetch) {
    return;
  }

  const recentEntries = returnedEntries
    .sort((left, right) => {
      const leftMs = new Date(left.answeredAt || left.sentAt || 0).getTime();
      const rightMs = new Date(right.answeredAt || right.sentAt || 0).getTime();
      return (Number.isFinite(rightMs) ? rightMs : 0) - (Number.isFinite(leftMs) ? leftMs : 0);
    })
    .slice(0, historyPrefetchEntryLimit);

  for (const entry of recentEntries) {
    void prefetchSessionHistory(entry.projectPath, entry.sessionId, { force: false });
  }
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

function normalizeProjectSummaryStatus(status) {
  const normalizedState = String(status?.state || "idle").trim().toLowerCase();
  return {
    state: ["idle", "running", "completed", "failed"].includes(normalizedState)
      ? normalizedState
      : "idle",
    requestId: String(status?.requestId || "").trim() || null,
    projectPath: String(status?.projectPath || "").trim() || null,
    startedAt: String(status?.startedAt || "").trim() || null,
    completedAt: String(status?.completedAt || "").trim() || null,
    provider: String(status?.provider || "").trim() || null,
    sessionId: String(status?.sessionId || "").trim() || null,
    sessionLabel: String(status?.sessionLabel || "").trim() || "",
    snapshotId: String(status?.snapshotId || "").trim() || null,
    error: String(status?.error || "").trim(),
  };
}

function normalizeDelegatePlanSnapshot(snapshot) {
  return {
    id: String(snapshot?.id || "").trim() || makeEntryId(),
    projectPath: String(snapshot?.projectPath || "").trim() || "",
    createdAt: String(snapshot?.createdAt || "").trim() || null,
    provider: String(snapshot?.provider || "").trim() || "codex",
    sessionId: String(snapshot?.sessionId || "").trim() || null,
    sessionLabel: String(snapshot?.sessionLabel || "").trim() || "",
    sourceEntryCount: Number.parseInt(String(snapshot?.sourceEntryCount || "0"), 10) || 0,
    summarySnapshotAt: String(snapshot?.summarySnapshotAt || "").trim() || null,
    plan: String(snapshot?.plan || ""),
  };
}

function normalizeDelegateRunEvent(event) {
  const step = Number.parseInt(String(event?.step || "0"), 10) || null;
  const rawCheckpoint =
    event?.checkpoint && typeof event.checkpoint === "object" && !Array.isArray(event.checkpoint)
      ? event.checkpoint
      : event?.payload?.checkpoint && typeof event.payload.checkpoint === "object" && !Array.isArray(event.payload.checkpoint)
        ? event.payload.checkpoint
        : null;
  return {
    id: String(event?.id || "").trim() || makeEntryId(),
    at: String(event?.at || event?.createdAt || "").trim() || null,
    type: String(event?.type || "event").trim() || "event",
    runId: String(event?.runId || "").trim() || null,
    step,
    requestId: String(event?.requestId || event?.request_id || "").trim() || null,
    title: String(event?.title || "").trim(),
    text: String(event?.text || "").trim(),
    summary: String(event?.summary || "").trim(),
    nextAction: String(event?.nextAction || event?.next_action || "").trim(),
    state: String(event?.state || "").trim(),
    stopReason: String(event?.stopReason || event?.stop_reason || "").trim(),
    error: String(event?.error || "").trim(),
    checkpoint: normalizeDelegateCheckpoint(rawCheckpoint),
    computeBudget: normalizeDelegateComputeBudget(event?.computeBudget),
  };
}

function normalizeWatchtowerCard(card) {
  const riskFlags = Array.isArray(card?.riskFlags)
    ? card.riskFlags
    : Array.isArray(card?.risk_flags)
      ? card.risk_flags
      : [];
  return {
    id: String(card?.id || "").trim() || makeEntryId(),
    eventId: String(card?.eventId || card?.event_id || "").trim(),
    projectPath: String(card?.projectPath || card?.project_path || "").trim(),
    runId: String(card?.runId || card?.run_id || "").trim() || null,
    at: String(card?.at || "").trim() || null,
    trigger: String(card?.trigger || "").trim(),
    title: String(card?.title || "").trim() || "Review card",
    summary: String(card?.summary || "").trim(),
    reviewStatus: String(card?.reviewStatus || card?.review_status || "info").trim(),
    riskFlags: riskFlags.map((flag) => String(flag || "").trim()).filter(Boolean),
  };
}

function normalizeWatchtowerEvent(event) {
  const riskFlags = Array.isArray(event?.riskFlags)
    ? event.riskFlags
    : Array.isArray(event?.risk_flags)
      ? event.risk_flags
      : [];
  return {
    id: String(event?.id || "").trim() || makeEntryId(),
    projectPath: String(event?.projectPath || event?.project_path || "").trim(),
    runId: String(event?.runId || event?.run_id || "").trim() || null,
    at: String(event?.at || "").trim() || null,
    title: String(event?.title || "").trim() || "Feed event",
    body: String(event?.body || "").trim(),
    workerSummary: String(event?.workerSummary || event?.worker_summary || "").trim(),
    activeOrpItem: String(event?.activeOrpItem || event?.active_orp_item || "").trim(),
    currentDecision: String(event?.currentDecision || event?.current_decision || "").trim(),
    reviewStatus: String(event?.reviewStatus || event?.review_status || "info").trim(),
    riskFlags: riskFlags.map((flag) => String(flag || "").trim()).filter(Boolean),
  };
}

function normalizeDelegateCheckpoint(checkpoint) {
  if (!checkpoint || typeof checkpoint !== "object" || Array.isArray(checkpoint)) {
    return null;
  }

  const confidence = String(checkpoint.confidence || "").trim().toLowerCase();
  const normalized = {
    progressSignal: String(checkpoint.progressSignal || checkpoint.progress_signal || "").trim(),
    breakthroughs: String(checkpoint.breakthroughs || checkpoint.breakthrough || "").trim(),
    blockers: String(checkpoint.blockers || checkpoint.blocker || "").trim(),
    nextProbe: String(checkpoint.nextProbe || checkpoint.next_probe || "").trim(),
    confidence: ["low", "medium", "high"].includes(confidence) ? confidence : "",
  };

  return Object.values(normalized).some(Boolean) ? normalized : null;
}

function normalizeDelegateRunSummarySnapshot(snapshot) {
  return {
    id: String(snapshot?.id || "").trim() || makeEntryId(),
    projectPath: String(snapshot?.projectPath || "").trim() || "",
    runId: String(snapshot?.runId || "").trim() || null,
    createdAt: String(snapshot?.createdAt || "").trim() || null,
    provider: String(snapshot?.provider || "").trim() || "codex",
    sourceEventCount: Number.parseInt(String(snapshot?.sourceEventCount || "0"), 10) || 0,
    summary: String(snapshot?.summary || ""),
  };
}

function normalizeDelegateRunInfo(run) {
  return {
    runId: String(run?.runId || "").trim() || null,
    state: String(run?.state || "").trim(),
    startedAt: String(run?.startedAt || "").trim() || null,
    updatedAt: String(run?.updatedAt || "").trim() || null,
    completedAt: String(run?.completedAt || "").trim() || null,
    lastEventAt: String(run?.lastEventAt || "").trim() || null,
    eventCount: Number.parseInt(String(run?.eventCount || "0"), 10) || 0,
    summary: String(run?.summary || "").trim(),
    error: String(run?.error || "").trim(),
    lastTitle: String(run?.lastTitle || "").trim(),
  };
}

function normalizeDelegateComputeBudget(budget) {
  if (!budget || typeof budget !== "object") {
    return null;
  }
  const usedPercent = Number.parseFloat(String(budget?.usedPercent ?? ""));
  const remainingPercent = Number.parseFloat(String(budget?.remainingPercent ?? ""));
  const reservePercent = Number.parseFloat(String(budget?.reservePercent ?? ""));
  return {
    status: String(budget?.status || "unavailable").trim(),
    checkedAt: String(budget?.checkedAt || "").trim() || null,
    source: String(budget?.source || "").trim() || null,
    limitId: String(budget?.limitId || "").trim() || null,
    limitName: String(budget?.limitName || "").trim() || null,
    windowMinutes: Number.parseInt(String(budget?.windowMinutes || "0"), 10) || null,
    usedPercent: Number.isFinite(usedPercent) ? usedPercent : null,
    remainingPercent: Number.isFinite(remainingPercent) ? remainingPercent : null,
    reservePercent: Number.isFinite(reservePercent) ? reservePercent : null,
    resetsAt: Number.parseInt(String(budget?.resetsAt || "0"), 10) || null,
    unlimited: Boolean(budget?.unlimited),
    error: String(budget?.error || "").trim(),
  };
}

function normalizeDelegateStatus(status) {
  const normalizedState = String(status?.state || "idle").trim().toLowerCase();
  const stepCount = Number.parseInt(String(status?.stepCount || "0"), 10) || 0;
  const activeRequestId = String(status?.activeRequestId || status?.active_request_id || "").trim() || null;
  const activeStep = Number.parseInt(String(status?.activeStep ?? status?.active_step ?? ""), 10);
  const normalizedActiveStep = Number.isFinite(activeStep) && activeStep > 0 ? activeStep : null;
  return {
    state: ["idle", "planning", "running", "paused", "blocked", "completed", "failed"].includes(normalizedState)
      ? normalizedState
      : "idle",
    runId: String(status?.runId || status?.requestId || "").trim() || null,
    projectPath: String(status?.projectPath || "").trim() || null,
    startedAt: String(status?.startedAt || "").trim() || null,
    updatedAt: String(status?.updatedAt || "").trim() || null,
    completedAt: String(status?.completedAt || "").trim() || null,
    delegateSessionId: String(status?.delegateSessionId || status?.sessionId || "").trim() || null,
    delegateSessionLabel: String(status?.delegateSessionLabel || status?.sessionLabel || "").trim() || "",
    planSnapshotId: String(status?.planSnapshotId || "").trim() || null,
    activeRequestId,
    activeStep: normalizedActiveStep || (normalizedState === "running" && activeRequestId ? stepCount + 1 : null),
    stepCount,
    maxSteps: Number.parseInt(String(status?.maxSteps || "0"), 10) || 0,
    computeBudget: normalizeDelegateComputeBudget(status?.computeBudget),
    lastOutcomeSummary: String(status?.lastOutcomeSummary || "").trim(),
    nextAction: String(status?.nextAction || "").trim(),
    stopReason: String(status?.stopReason || "").trim(),
    pauseRequested: Boolean(status?.pauseRequested),
    error: String(status?.error || "").trim(),
  };
}

function projectSummaryIsPending(summaryState) {
  return Boolean(summaryState?.pending) || summaryState?.summaryStatus?.state === "running";
}

function delegateStateIsPending(delegateState) {
  const status = delegateState?.status?.state;
  return (
    Boolean(state.delegateBriefPending) ||
    Boolean(state.delegatePlanPending) ||
    Boolean(state.delegateRunPending) ||
    status === "planning" ||
    status === "running"
  );
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
    provider: activeSession?.provider || project.provider || "codex",
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
  const hydratedProject = hydrateProjectVisuals(updatedProject);

  state.projects = state.projects.map((project) =>
    project.path === hydratedProject.path ? hydratedProject : project,
  );
  state.projects.sort(compareProjects);
}

function upsertProject(projectDetails) {
  if (!projectDetails?.path) {
    return;
  }
  const hydratedProject = hydrateProjectVisuals(projectDetails);

  const existingIndex = state.projects.findIndex((project) => project.path === hydratedProject.path);
  if (existingIndex >= 0) {
    state.projects.splice(existingIndex, 1, hydratedProject);
  } else {
    state.projects = [...state.projects, hydratedProject];
  }
  state.projects.sort(compareProjects);
}

function removeProject(projectPath) {
  state.projects = state.projects.filter((project) => project.path !== projectPath);
}

function projectCatalogDelegateStatus(status, projectPath) {
  if (!status) {
    return null;
  }

  const normalized = normalizeDelegateStatus({
    ...status,
    projectPath: status.projectPath || projectPath,
  });
  if (normalized.state === "idle") {
    return null;
  }

  return normalized;
}

function updateProjectDelegateStatus(projectPath, status) {
  if (!projectPath) {
    return;
  }

  const projectIndex = state.projects.findIndex((project) => project.path === projectPath);
  if (projectIndex < 0) {
    return;
  }

  state.projects.splice(
    projectIndex,
    1,
    hydrateProjectVisuals({
      ...state.projects[projectIndex],
      delegateStatus: projectCatalogDelegateStatus(status, projectPath),
    }),
  );
  state.projects.sort(compareProjects);
}

function pruneTrackedArtifacts(projectPath, sessionId = "") {
  const normalizedProjectPath = String(projectPath || "").trim();
  const normalizedSessionId = String(sessionId || "").trim();
  if (!normalizedProjectPath) {
    return;
  }

  if (normalizedSessionId) {
    state.threadEntries = state.threadEntries.filter(
      (entry) =>
        !(
          entry.projectPath === normalizedProjectPath &&
          entry.sessionId === normalizedSessionId
        ),
    );
    persistThreadEntries();

    delete state.historyThreads[historyKey(normalizedProjectPath, normalizedSessionId)];
    delete state.pendingSessionRenames[sessionRenameKey(normalizedProjectPath, normalizedSessionId)];

    if (
      state.modalThread?.projectPath === normalizedProjectPath &&
      state.modalThread?.sessionId === normalizedSessionId
    ) {
      state.modalThread = null;
    }
    if (
      state.sessionTitleModalProject === normalizedProjectPath &&
      state.sessionTitleModalSessionId === normalizedSessionId
    ) {
      closeSessionTitleModal();
      return;
    }
    return;
  }

  state.threadEntries = state.threadEntries.filter(
    (entry) => entry.projectPath !== normalizedProjectPath,
  );
  persistThreadEntries();

  for (const key of Object.keys(state.historyThreads)) {
    if (key.startsWith(`${normalizedProjectPath}::`)) {
      delete state.historyThreads[key];
    }
  }

  for (const key of Object.keys(state.pendingSessionRenames)) {
    if (key.startsWith(`${normalizedProjectPath}::`)) {
      delete state.pendingSessionRenames[key];
    }
  }

  delete state.projectSummaries[normalizedProjectPath];
  delete state.artifactsByProject[normalizedProjectPath];
  delete state.delegatesByProject[normalizedProjectPath];
  clearImportableSessionsState(normalizedProjectPath);

  if (state.modalThread?.projectPath === normalizedProjectPath) {
    state.modalThread = null;
  }
  if (state.sessionImportModalProject === normalizedProjectPath) {
    closeSessionImportModal();
    return;
  }
  if (state.summaryModalProject === normalizedProjectPath) {
    state.summaryModalProject = "";
  }
  if (state.artifactModalProject === normalizedProjectPath) {
    state.artifactModalProject = "";
  }
  if (state.delegateModalProject === normalizedProjectPath) {
    closeDelegateModal();
    return;
  }
  if (state.sessionTitleModalProject === normalizedProjectPath) {
    closeSessionTitleModal();
    return;
  }
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
    const projects = Array.isArray(payload.projects)
      ? payload.projects.map(hydrateProjectVisuals).sort(compareProjects)
      : [];
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

function entryAgePastAttachGraceWindow(entry) {
  const sentAtMs = entrySentAtMs(entry);
  return sentAtMs > 0 && Date.now() - sentAtMs > queuedDispatchAttachGraceMs;
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

function updateThreadEntrySessionLabels(projectPath, sessionId, sessionLabel) {
  if (!projectPath || !sessionId || !sessionLabel) {
    return;
  }

  let changed = false;
  state.threadEntries = state.threadEntries.map((entry) => {
    if (entry.projectPath !== projectPath || entry.sessionId !== sessionId) {
      return entry;
    }

    if (entry.sessionLabel === sessionLabel) {
      return entry;
    }

    changed = true;
    return {
      ...entry,
      sessionLabel,
    };
  });

  if (changed) {
    persistThreadEntries();
  }
}

function appendThreadEntry(entry) {
  state.threadEntries = [...state.threadEntries, entry];
  persistThreadEntries();
  hydrateHistoryFromThreadEntry(entry);
}

function completeThreadEntry(entry, patch) {
  updateThreadEntry(entry.id, patch);
  const completedEntry = entryById(entry.id) || {
    ...entry,
    ...(typeof patch === "function" ? patch(entry) : patch),
  };
  hydrateHistoryFromThreadEntry(completedEntry);
  if (entryHasReturned(completedEntry)) {
    void prefetchSessionHistory(completedEntry.projectPath, completedEntry.sessionId, { force: true });
  }
}

function sessionStatusLabel(entry) {
  if (entry.status === "queued") {
    return currentProcessingPhrase();
  }
  if (entry.status === "failed") {
    return "failed";
  }
  return "cajun butter";
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
  if (status !== "running" && status !== "dispatched") {
    return false;
  }

  const dispatchMs = new Date(session?.lastDispatch || 0).getTime();
  const responseMs = new Date(session?.lastResponse || 0).getTime();
  if (
    Number.isFinite(dispatchMs) &&
    dispatchMs > 0 &&
    Number.isFinite(responseMs) &&
    responseMs >= dispatchMs - 1000
  ) {
    return false;
  }

  return true;
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
  button.dataset.copyKey = copyKey;
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

function refreshCopyButtons(root = document) {
  for (const button of root.querySelectorAll(".copy-button[data-copy-key]")) {
    decorateCopyButton(button, button.dataset.copyKey || "");
  }
}

function projectOptionLabel(project) {
  const label = project?.displayName || project?.slug || project?.path || "Project";
  return projectHasLiveDelegate(project) ? `\u221e ${label}` : label;
}

function appendProjectOption(parent, project) {
  const option = document.createElement("option");
  option.value = project.path;
  option.textContent = projectOptionLabel(project);
  parent.append(option);
}

function appendProjectOptionGroup(label, projects) {
  if (projects.length === 0) {
    return;
  }

  const group = document.createElement("optgroup");
  group.label = label;
  for (const project of projects) {
    appendProjectOption(group, project);
  }
  elements.projectSelect.append(group);
}

function groupedProjectOptions() {
  const featured = [];
  const liveDelegates = [];
  const projects = [];

  for (const project of state.projects) {
    if (project?.featured || project?.specialRole === "global-mind") {
      featured.push(project);
    } else if (projectHasLiveDelegate(project)) {
      liveDelegates.push(project);
    } else {
      projects.push(project);
    }
  }

  return {
    featured,
    liveDelegates,
    projects,
  };
}

function renderProjectOptions() {
  if (controlInteractionLocked("project-select")) {
    return;
  }
  const disabled = state.dispatchPending || (state.projectsLoading && state.projects.length === 0);
  const renderKey = JSON.stringify({
    disabled,
    loading: Boolean(state.projectsLoading && state.projects.length === 0),
    selectedProject: state.selectedProject,
    projects: state.projects.map((project) => [
      project.path,
      project.displayName || project.slug || project.path,
      Number(Boolean(project.featured)),
      project.specialRole || "",
      projectDelegateStatusKey(project),
    ]),
  });
  if (elements.projectSelect.dataset.renderKey === renderKey) {
    return;
  }
  elements.projectSelect.innerHTML = "";

  if (state.projectsLoading && state.projects.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "Loading projects…";
    elements.projectSelect.append(option);
    elements.projectSelect.disabled = true;
    elements.projectSelect.dataset.renderKey = renderKey;
    return;
  }

  if (state.projects.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No projects";
    elements.projectSelect.append(option);
    elements.projectSelect.disabled = true;
    elements.projectSelect.dataset.renderKey = renderKey;
    return;
  }

  const projectGroups = groupedProjectOptions();
  for (const project of projectGroups.featured) {
    appendProjectOption(elements.projectSelect, project);
  }
  appendProjectOptionGroup("\u221e Live delegation", projectGroups.liveDelegates);
  appendProjectOptionGroup("Projects", projectGroups.projects);

  elements.projectSelect.disabled = disabled;
  elements.projectSelect.value = state.selectedProject;
  elements.projectSelect.dataset.renderKey = renderKey;
}

function updateProjectControlAppearance() {
  const project = currentProject();
  const isFeatured = Boolean(project?.featured);
  const hasLiveDelegates = state.projects.some((entry) => projectHasLiveDelegate(entry));
  const selectedProjectIsLive = projectHasLiveDelegate(project);
  const projectControl = elements.projectSelect.closest(".project-control");

  elements.projectSelect.classList.toggle("is-featured", isFeatured);
  elements.projectSelect.classList.toggle("is-live-delegate", selectedProjectIsLive);
  projectControl?.classList.toggle("is-featured", isFeatured);
  projectControl?.classList.toggle("has-live-delegates", hasLiveDelegates);
  projectControl?.classList.toggle("is-live-delegate", selectedProjectIsLive);
  elements.projectDelegateButton.classList.toggle("has-live-delegates", hasLiveDelegates);
  elements.projectDelegateButton.setAttribute(
    "aria-label",
    hasLiveDelegates ? "Open auto delegate, live delegation active" : "Open auto delegate",
  );
}

function renderSessionOptions() {
  if (controlInteractionLocked("session-select")) {
    return;
  }
  const project = currentProject();
  const sessions = Array.isArray(project?.sessions) ? project.sessions : [];
  const selectedSession =
    sessions.find((session) => session.sessionId === state.selectedSessionId) || null;
  const sessionBusy = Boolean(
    selectedSession?.pendingCreation ||
      sessionRenamePending(project?.path, selectedSession?.sessionId),
  );
  const disabled =
    !project ||
    sessions.length === 0 ||
    state.sessionSwitchPending ||
    state.dispatchPending;
  const renderKey = JSON.stringify({
    projectPath: project?.path || "",
    disabled,
    sessionBusy,
    selectedSessionId: state.selectedSessionId,
    sessions: sessions.map((session) => [
      session.sessionId || "",
      sessionOptionLabel(session, project?.path),
      session.status || "",
      session.lastDispatch || "",
      session.lastResponse || "",
      Boolean(session.pendingCreation),
      sessionRenamePending(project?.path, session.sessionId),
    ]),
  });
  if (elements.sessionSelect.dataset.renderKey === renderKey) {
    return;
  }
  elements.sessionSelect.innerHTML = "";

  if (!project) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "Session";
    elements.sessionSelect.append(option);
    elements.sessionSelect.disabled = true;
    elements.sessionControl?.classList.remove("is-loading");
    elements.sessionSelect.dataset.renderKey = renderKey;
    return;
  }

  if (sessions.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No sessions";
    elements.sessionSelect.append(option);
    elements.sessionSelect.disabled = true;
    elements.sessionControl?.classList.remove("is-loading");
    elements.sessionSelect.dataset.renderKey = renderKey;
    return;
  }

  for (const session of sessions) {
    const option = document.createElement("option");
    option.value = session.sessionId || "";
    option.textContent = sessionOptionLabel(session, project.path);
    elements.sessionSelect.append(option);
  }

  elements.sessionControl?.classList.toggle(
    "is-loading",
    sessionBusy,
  );
  elements.sessionSelect.disabled = disabled;
  elements.sessionSelect.value = state.selectedSessionId;
  elements.sessionSelect.dataset.renderKey = renderKey;
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
    Boolean(currentModalThread()) ||
      Boolean(state.sessionImportModalProject) ||
      state.projectModalOpen ||
      Boolean(state.summaryModalProject) ||
      Boolean(state.artifactModalProject) ||
      Boolean(state.delegateModalProject) ||
      Boolean(state.sessionTitleModalProject),
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

function renderSessionTitleModal() {
  const { project, session } = currentSessionTitleTarget();
  if (!project || !session) {
    elements.sessionTitleModal.hidden = true;
    return;
  }

  elements.sessionTitleProject.textContent =
    project.displayName || project.slug || fallbackProjectLabel(project.path);
  elements.sessionTitleSession.textContent = sessionFixedSuffix(session);
  elements.sessionTitleInput.value = state.sessionTitleDraft;
  elements.sessionTitleInput.disabled = state.sessionTitlePending;
  elements.sessionTitleRemoveButton.disabled = state.sessionTitlePending;
  elements.sessionTitleRemoveButton.querySelector(".button-text").textContent =
    state.sessionTitleConfirmRemove ? "Ya sure?" : "Remove session";
  elements.sessionTitleSaveButton.disabled =
    state.sessionTitlePending || !state.sessionTitleDraft.trim();
  elements.sessionTitleSaveButton.querySelector(".button-text").textContent =
    state.sessionTitlePending ? "Saving…" : "Save";

  setText(
    elements.sessionTitleState,
    state.sessionTitleError ||
      (state.sessionTitleConfirmRemove
        ? "Ya sure? This only stops tracking the session."
        : "Provider and short id stay attached. Remove stops tracking only."),
    { empty: false },
  );

  elements.sessionTitleModal.hidden = false;
}

function renderSessionImportModal() {
  const project = currentSessionImportProject();
  if (!project) {
    elements.sessionImportModal.hidden = true;
    return;
  }

  const importState = importableSessionsStateFor(project.path);
  const importingSessionId = state.sessionImportPendingId;
  elements.sessionImportProject.textContent =
    project.displayName || project.slug || fallbackProjectLabel(project.path);

  let stateText = "";
  if (importState.loading && !importState.initialized) {
    stateText = "Looking for local Codex sessions";
  } else if (importState.error) {
    stateText = importState.error;
  } else if (importState.items.length > 0) {
    const count = importState.items.length;
    stateText = `${count} local session${count === 1 ? "" : "s"} ready to import`;
  } else {
    stateText = "No untracked local Codex sessions";
  }
  setText(elements.sessionImportState, stateText, { empty: !stateText });

  clearNode(elements.sessionImportList);

  if (importState.loading && !importState.initialized) {
    const empty = document.createElement("div");
    empty.className = "import-session-empty";
    empty.textContent = "Looking for local Codex sessions…";
    elements.sessionImportList.append(empty);
    elements.sessionImportModal.hidden = false;
    return;
  }

  if (importState.items.length === 0) {
    const empty = document.createElement("div");
    empty.className = "import-session-empty";
    empty.textContent = importState.error || "No local untracked Codex sessions for this project yet.";
    elements.sessionImportList.append(empty);
    elements.sessionImportModal.hidden = false;
    return;
  }

  for (const session of importState.items) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "import-session-card";
    button.disabled = Boolean(importingSessionId);

    const title = document.createElement("div");
    title.className = "import-session-title";
    title.textContent = importingSessionId === session.sessionId ? "Importing…" : importableSessionLabel(session);

    const meta = document.createElement("div");
    meta.className = "import-session-meta";
    meta.textContent = session.source || "cli";

    const preview = document.createElement("div");
    preview.className = "import-session-preview";
    preview.textContent = session.preview || "Saved locally in this repo.";

    const time = document.createElement("div");
    time.className = "import-session-time";
    time.textContent = formatTimestamp(session.lastUpdatedAt || session.timestamp) || "";

    button.append(title, meta, preview, time);
    button.addEventListener("click", () => {
      void handleSessionImport(session.sessionId);
    });
    elements.sessionImportList.append(button);
  }

  elements.sessionImportModal.hidden = false;
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

async function refreshImportableSessions(projectPath, { force = false } = {}) {
  const normalizedProjectPath = String(projectPath || "").trim();
  if (!normalizedProjectPath) {
    return importableSessionsStateFor("");
  }

  const existing = importableSessionsStateFor(normalizedProjectPath);
  if (existing.promise) {
    return existing.promise;
  }
  if (
    !force &&
    existing.initialized &&
    Date.now() - Number(existing.loadedAt || 0) < importableSessionsCacheMs
  ) {
    return existing;
  }

  const shouldRender = state.sessionImportModalProject === normalizedProjectPath;
  setImportableSessionsState(normalizedProjectPath, {
    loading: true,
    error: "",
  });
  if (shouldRender) {
    renderAll();
  } else {
    updateImportButtonAvailability();
  }

  const promise = (async () => {
    try {
      const payload = await fetchJson(
        `/v1/importable-sessions?project=${encodeURIComponent(normalizedProjectPath)}`,
      );
      setImportableSessionsState(normalizedProjectPath, {
        items: Array.isArray(payload.sessions) ? payload.sessions : [],
        loading: false,
        initialized: true,
        loadedAt: Date.now(),
        error: "",
        promise: null,
      });
    } catch (error) {
      setImportableSessionsState(normalizedProjectPath, {
        items: existing.items || [],
        loading: false,
        initialized: true,
        loadedAt: Date.now(),
        error: error.message,
        promise: null,
      });
      throw error;
    } finally {
      renderAll();
    }

    return importableSessionsStateFor(normalizedProjectPath);
  })();

  setImportableSessionsState(normalizedProjectPath, {
    promise,
  });
  return promise;
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
    const unread = entryIsUnread(entry);
    const card = document.createElement("article");
    card.className = `queue-card ${entry.status === "queued" ? "processing" : entry.status === "answered" ? "done" : "failed"}`;
    card.classList.toggle("is-unread", unread);
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

    const headStatus = document.createElement("div");
    headStatus.className = "queue-head-status";

    if (unread) {
      const unreadOrb = document.createElement("span");
      unreadOrb.className = "queue-card-unread-orb";
      unreadOrb.setAttribute("aria-hidden", "true");
      headStatus.append(unreadOrb);
    }

    const chip = document.createElement("div");
    chip.className = `queue-chip ${entry.status === "queued" ? "processing" : entry.status === "answered" ? "done" : "failed"}`;
    chip.textContent = sessionStatusLabel(entry);
    headStatus.append(chip);

    head.append(project, headStatus);

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
  group.dataset.historyAnchor = entry.requestId || entry.sentAt || entry.answeredAt || entry.message || "";

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
      ? `${currentProcessingPhrase()}…`
      : entry.response || (entry.status === "failed" ? "Failed." : "");
  const inboundMeta =
    entry.status === "queued"
      ? currentProcessingPhrase()
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
    delete elements.detailHistoryList.dataset.threadKey;
    delete elements.detailHistoryList.dataset.renderKey;
    detailHistoryRenderSnapshot = null;
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
  const threadKey = historyKey(modalThread.projectPath, modalThread.sessionId);
  const renderKey = historyRenderSignature(historyState);
  const existingThreadKey = elements.detailHistoryList.dataset.threadKey || "";
  const existingRenderKey = elements.detailHistoryList.dataset.renderKey || "";

  elements.detailProject.textContent =
    project?.displayName || fallbackProjectLabel(modalThread.projectPath);
  elements.detailSession.textContent = sessionOptionLabel(session, modalThread.projectPath);

  if (historyState.error) {
    setText(elements.detailHistoryState, "History unavailable", { empty: false });
  } else if (historyState.loading && !historyState.initialized) {
    setText(elements.detailHistoryState, "Loading thread", { empty: false });
  } else if (historyState.nextCursor) {
    setText(elements.detailHistoryState, "Scroll up for older messages", { empty: false });
  } else {
    setText(elements.detailHistoryState, "", { empty: true });
  }

  if (existingThreadKey === threadKey && existingRenderKey === renderKey) {
    elements.detailModal.hidden = false;
    return;
  }

  const scrollSnapshot =
    detailHistoryRenderSnapshot?.threadKey === threadKey
      ? detailHistoryRenderSnapshot
      : existingThreadKey === threadKey
        ? captureDetailHistorySnapshot(threadKey, "smart")
        : null;
  detailHistoryRenderSnapshot = null;

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

  elements.detailHistoryList.dataset.threadKey = threadKey;
  elements.detailHistoryList.dataset.renderKey = renderKey;
  elements.detailModal.hidden = false;
  applyDetailHistorySnapshot(scrollSnapshot);
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

function delegateStopReasonLabel(stopReason) {
  switch (String(stopReason || "").trim()) {
    case "paid":
      return "blocked on something paid";
    case "needs_human":
      return "blocked on another human";
    case "auth_required":
      return "blocked on auth";
    case "compute_limit":
      return "paused near compute reserve";
    case "step_limit":
      return "paused at step limit";
    case "unknown":
      return "blocked";
    default:
      return "";
  }
}

function delegateComputeBudgetLabel(budget) {
  const normalized = normalizeDelegateComputeBudget(budget);
  if (!normalized || normalized.status !== "observed" || normalized.unlimited) {
    return "";
  }
  if (!Number.isFinite(normalized.remainingPercent)) {
    return "";
  }
  const remaining = Math.round(normalized.remainingPercent * 10) / 10;
  return ` • ${remaining}% compute left`;
}

function delegateComputeBudgetCompactLabel(budget) {
  const label = delegateComputeBudgetLabel(budget).replace(/^ •\s*/u, "").trim();
  return label || "guard ready";
}

function delegateStatusOverviewLabel(status, delegateState) {
  if (state.delegateBriefPending) {
    return "saving";
  }
  if (state.delegatePlanPending || status?.state === "planning") {
    return "planning";
  }
  if (state.delegateRunPending) {
    return "starting";
  }
  if (status?.state === "running") {
    return status.pauseRequested ? "pausing" : "running";
  }
  if (status?.state === "blocked") {
    return delegateStopReasonLabel(status.stopReason) || "blocked";
  }
  if (status?.state === "completed") {
    return "completed";
  }
  if (status?.state === "failed") {
    return "failed";
  }
  if (delegateState?.loading && !delegateState.initialized) {
    return "loading";
  }
  return "idle";
}

function appendDelegateOverviewItem(root, label, value, tone = "") {
  const item = document.createElement("div");
  item.className = `delegate-overview-item${tone ? ` ${tone}` : ""}`;

  const labelNode = document.createElement("span");
  labelNode.className = "delegate-overview-label";
  labelNode.textContent = label;

  const valueNode = document.createElement("span");
  valueNode.className = "delegate-overview-value";
  valueNode.textContent = value || "none";

  item.append(labelNode, valueNode);
  root.append(item);
}

function shortDelegateRunText(text, fallback = "", maxLength = 90) {
  const value = String(text || "").replace(/\s+/gu, " ").trim();
  if (!value) {
    return fallback;
  }
  const limit = Math.max(24, Number.parseInt(String(maxLength || 90), 10) || 90);
  return value.length > limit ? `${value.slice(0, limit - 3).trim()}...` : value;
}

function delegateRunCardData(delegateState, runLog) {
  const runs = new Map();
  for (const run of delegateState?.runList || []) {
    if (!run?.runId) {
      continue;
    }
    runs.set(run.runId, {
      runId: run.runId,
      state: run.state || "run",
      at: run.completedAt || run.updatedAt || run.lastEventAt || run.startedAt || "",
      eventCount: run.eventCount || 0,
      summary: run.error || run.summary || run.lastTitle || "",
    });
  }

  const status = delegateState?.status || null;
  if (status?.runId) {
    const existing = runs.get(status.runId) || {};
    runs.set(status.runId, {
      runId: status.runId,
      state: status.state || "run",
      at: status.completedAt || status.updatedAt || status.startedAt || "",
      eventCount: runLog?.runId === status.runId ? Number(runLog.total || runLog.events?.length || 0) : existing.eventCount || 0,
      summary: status.error || status.lastOutcomeSummary || status.nextAction || existing.summary || "",
    });
  }

  for (const snapshot of delegateState?.runSummarySnapshots || []) {
    if (!snapshot?.runId) {
      continue;
    }
    const existing = runs.get(snapshot.runId) || {};
    runs.set(snapshot.runId, {
      runId: snapshot.runId,
      state: existing.state || "summary",
      at: existing.at || snapshot.createdAt || "",
      eventCount: existing.eventCount || snapshot.sourceEventCount || 0,
      summary: existing.summary || snapshot.summary || "",
    });
  }

  if (runLog?.runId && !runs.has(runLog.runId)) {
    runs.set(runLog.runId, {
      runId: runLog.runId,
      state: "run",
      at: "",
      eventCount: Number(runLog.total || runLog.events?.length || 0),
      summary: "",
    });
  }

  return [...runs.values()].sort((left, right) => {
    const leftMs = Date.parse(left.at || "");
    const rightMs = Date.parse(right.at || "");
    return (Number.isFinite(rightMs) ? rightMs : 0) - (Number.isFinite(leftMs) ? leftMs : 0);
  });
}

function buildDelegateRunCard(run, { selected = false } = {}) {
  const button = document.createElement("button");
  button.className = `delegate-run-card${selected ? " is-selected" : ""}`;
  button.type = "button";
  button.dataset.delegateRunId = run.runId;

  const head = document.createElement("div");
  head.className = "delegate-run-card-head";

  const title = document.createElement("span");
  title.className = "delegate-run-card-title";
  title.textContent = delegateRunStateLabel(run.state);

  head.append(title);
  button.append(head);
  return button;
}

function delegateRunStateLabel(state) {
  const value = String(state || "").trim().toLowerCase();
  switch (value) {
    case "running":
      return "Auto running";
    case "paused":
      return "Auto paused";
    case "blocked":
      return "Auto blocked";
    case "completed":
      return "Auto completed";
    case "failed":
      return "Auto failed";
    case "planning":
      return "Auto planning";
    case "idle":
      return "Auto idle";
    case "summary":
      return "Auto summary";
    default:
      return "Auto session";
  }
}

function renderDelegateCarouselChrome() {
  const activeSlideId = delegateCarouselSlides[delegateCarouselSlideIndex()]?.id || "runs";
  const activeSlide = delegateCarouselSlides.find((slide) => slide.id === activeSlideId) || delegateCarouselSlides[0];
  const panelBySlide = {
    runs: elements.delegateRunsPanel,
    log: elements.delegateRunLogPanel,
    review: elements.delegateReviewPanel,
    brief: elements.delegateBriefPanel,
  };

  for (const slide of delegateCarouselSlides) {
    const panel = panelBySlide[slide.id];
    if (panel) {
      panel.hidden = slide.id !== activeSlideId;
      panel.classList.toggle("is-active", slide.id === activeSlideId);
    }
  }

  if (elements.delegateCarouselTitle) {
    elements.delegateCarouselTitle.textContent = activeSlide.label;
  }
  if (elements.delegateCarouselMeta) {
    elements.delegateCarouselMeta.textContent = "";
  }
  if (elements.delegateCarouselPrev) {
    const previousIndex = (delegateCarouselSlideIndex() - 1 + delegateCarouselSlides.length) % delegateCarouselSlides.length;
    elements.delegateCarouselPrev.textContent = delegateCarouselSlides[previousIndex].label;
  }
  if (elements.delegateCarouselNext) {
    const nextIndex = (delegateCarouselSlideIndex() + 1) % delegateCarouselSlides.length;
    elements.delegateCarouselNext.textContent = delegateCarouselSlides[nextIndex].label;
  }

  clearNode(elements.delegateCarouselTabs);
  for (const slide of delegateCarouselSlides) {
    const button = document.createElement("button");
    const briefNeedsSave = slide.id === "brief" && state.delegateBriefDirty;
    button.className = [
      "delegate-carousel-tab",
      slide.id === activeSlideId ? "is-active" : "",
      briefNeedsSave ? "has-unsaved" : "",
    ].filter(Boolean).join(" ");
    button.type = "button";
    button.role = "tab";
    button.ariaSelected = slide.id === activeSlideId ? "true" : "false";
    button.ariaLabel = briefNeedsSave ? "Brief has unsaved changes" : slide.label;
    button.dataset.delegateSlide = slide.id;
    button.textContent = slide.label;
    elements.delegateCarouselTabs.append(button);
  }
}

function delegatePercentText(value) {
  const numeric = Number.parseFloat(String(value ?? ""));
  if (!Number.isFinite(numeric)) {
    return "";
  }

  const rounded = Math.round(numeric * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1).replace(/\.0$/u, "");
}

function delegateComputeBudgetEventText(budget) {
  const normalized = normalizeDelegateComputeBudget(budget);
  if (!normalized || normalized.status !== "observed") {
    return "";
  }
  if (normalized.unlimited) {
    return "Compute appears unlimited right now, so no weekly reserve pressure is visible.";
  }

  const used = delegatePercentText(normalized.usedPercent);
  const remaining = delegatePercentText(normalized.remainingPercent);
  if (!used || !remaining) {
    return "";
  }

  const reserve = delegatePercentText(normalized.reservePercent);
  const reservePhrase = reserve
    ? Number.isFinite(normalized.remainingPercent) &&
      Number.isFinite(normalized.reservePercent) &&
      normalized.remainingPercent <= normalized.reservePercent
      ? `, with the ${reserve}% reserve now reached.`
      : `, with the ${reserve}% reserve still protected.`
    : ".";
  return `Compute is at ${used}% used, ${remaining}% remaining${reservePhrase}`;
}

function buildDelegatePlanCard(snapshot) {
  const card = document.createElement("article");
  card.className = "summary-card";

  const copyButton = buildCopyButton({
    copyKey: `delegate-plan:${snapshot.id}`,
    label: "Copy plan",
    text: snapshot.plan,
  });
  card.append(copyButton);

  const head = document.createElement("div");
  head.className = "summary-head";

  const timestamp = document.createElement("div");
  timestamp.className = "summary-timestamp";
  timestamp.textContent = formatTimestamp(snapshot.createdAt) || "Saved plan";

  const sourceMeta = document.createElement("div");
  sourceMeta.className = "summary-source-meta";
  const sourceCountLabel = `${snapshot.sourceEntryCount} note${snapshot.sourceEntryCount === 1 ? "" : "s"}`;
  const sessionLabel = snapshot.sessionLabel || providerLabel(snapshot.provider);
  sourceMeta.textContent = `${sessionLabel} • ${sourceCountLabel}`;

  head.append(timestamp, sourceMeta);

  const body = document.createElement("div");
  body.className = "thread-text";
  renderRichText(body, snapshot.plan, { emptyText: "No saved delegate plan yet." });

  card.append(head, body);
  return card;
}

function delegateRunTypeLabel(type) {
  const normalized = String(type || "event").trim().replace(/_/g, " ");
  return normalized
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || "Event";
}

function delegateEventMetaText(event) {
  const pieces = [];
  const timestamp = formatTimestamp(event.at);
  if (timestamp) {
    pieces.push(timestamp);
  }
  if (event.step) {
    pieces.push(`step ${event.step}`);
  }
  const typeLabel = delegateRunTypeLabel(event.type);
  if (typeLabel && typeLabel !== event.title) {
    pieces.push(typeLabel);
  }
  if (event.state) {
    pieces.push(event.state);
  }
  return pieces.join(" • ");
}

function delegateEventBodyText(event, { compact = false } = {}) {
  const computeText = event.text ? "" : delegateComputeBudgetEventText(event.computeBudget);
  const value =
    event.error ||
    event.summary ||
    event.text ||
    event.nextAction ||
    computeText ||
    delegateRunTypeLabel(event.type);
  return compact ? shortDelegateRunText(value, delegateRunTypeLabel(event.type), 320) : value;
}

function buildDelegateRunEventCard(event, { compact = false, live = false } = {}) {
  const card = document.createElement("article");
  card.className = [
    "delegate-event-card",
    event.error ? "failed" : "",
    live ? "is-live" : "",
  ].filter(Boolean).join(" ");
  card.dataset.delegateLogAnchor = `event:${event.id || event.at || event.type || ""}`;

  const head = document.createElement("div");
  head.className = "delegate-event-head";

  const title = document.createElement("div");
  title.className = "delegate-event-title";
  title.textContent = event.title || delegateRunTypeLabel(event.type);

  const meta = document.createElement("div");
  meta.className = "delegate-event-meta";
  meta.textContent = delegateEventMetaText(event);

  head.append(title, meta);

  const body = document.createElement("div");
  body.className = "thread-text delegate-event-body";
  const bodyText = delegateEventBodyText(event, { compact });
  renderRichText(body, bodyText, { emptyText: delegateRunTypeLabel(event.type) });

  card.append(head, body);
  return card;
}

function watchtowerStatusLabel(status) {
  return String(status || "info").replace(/_/g, " ");
}

function buildWatchtowerReviewCard(card) {
  const root = document.createElement("article");
  root.className = [
    "delegate-review-card",
    `is-${String(card.reviewStatus || "info").replace(/_/g, "-")}`,
  ].join(" ");

  const head = document.createElement("div");
  head.className = "delegate-event-head";

  const title = document.createElement("div");
  title.className = "delegate-event-title";
  title.textContent = card.title;

  const meta = document.createElement("div");
  meta.className = "delegate-event-meta";
  meta.textContent = [
    watchtowerStatusLabel(card.reviewStatus),
    formatTimestamp(card.at),
    card.trigger,
    card.runId ? `run ${card.runId}` : "",
  ].filter(Boolean).join(" • ");

  head.append(title, meta);

  const body = document.createElement("div");
  body.className = "thread-text delegate-event-body";
  renderRichText(body, card.summary, { emptyText: "No review details captured yet." });

  root.append(head, body);
  if (card.riskFlags.length > 0) {
    const risks = document.createElement("div");
    risks.className = "delegate-review-risks";
    risks.textContent = card.riskFlags.join(" • ");
    root.append(risks);
  }
  return root;
}

function latestDelegateEvent(events, predicate = () => true) {
  return [...(Array.isArray(events) ? events : [])]
    .reverse()
    .find((event) => event && predicate(event)) || null;
}

function delegateRunCurrentText(delegateState, runLog, events) {
  const status = delegateState?.status || {};
  const latestLive = latestDelegateEvent(events, (event) => event.type === "agent_live" && event.text);
  if (latestLive) {
    return {
      title: "Live stream",
      meta: delegateEventMetaText(latestLive),
      text: latestLive.text,
    };
  }

  const latestStarted = latestDelegateEvent(events, (event) => event.type === "step_started");
  if (status?.state === "running") {
    return {
      title: "Live stream",
      meta: latestStarted ? delegateEventMetaText(latestStarted) : "waiting on agent",
      text:
        latestStarted?.text ||
        status.nextAction ||
        "The delegate is working on the current step. Live text appears here as the agent writes.",
    };
  }

  const latestEvent = latestDelegateEvent(events);
  return {
    title: "Latest activity",
    meta: latestEvent ? delegateEventMetaText(latestEvent) : "",
    text:
      latestEvent?.error ||
      latestEvent?.summary ||
      latestEvent?.text ||
      status?.lastOutcomeSummary ||
      runLog?.error ||
      "No live activity captured yet.",
  };
}

function buildDelegateLiveCurrentCard(delegateState, runLog, events) {
  const current = delegateRunCurrentText(delegateState, runLog, events);
  const card = document.createElement("article");
  card.className = "delegate-live-current";
  card.dataset.delegateLogAnchor = "live-current";

  const kicker = document.createElement("div");
  kicker.className = "delegate-current-kicker";
  kicker.textContent = current.meta || "live";

  const title = document.createElement("div");
  title.className = "delegate-current-title";
  title.textContent = current.title;

  const body = document.createElement("div");
  body.className = "thread-text delegate-current-body";
  renderRichText(body, current.text, { emptyText: "Waiting for live agent output." });

  card.append(kicker, title, body);
  return card;
}

function delegateStepSnapshots(events = []) {
  const steps = new Map();
  for (const event of events) {
    if (!event?.step) {
      continue;
    }

    const existing = steps.get(event.step) || {
      step: event.step,
      startedAt: "",
      completedAt: "",
      latestAt: "",
      title: "",
      summary: "",
      nextAction: "",
      state: "",
      stopReason: "",
      error: "",
      checkpoint: null,
      liveText: "",
      responseText: "",
      events: [],
    };

    existing.events.push(event);
    existing.latestAt = event.at || existing.latestAt;
    if (event.type === "step_started") {
      existing.startedAt = event.at || existing.startedAt;
      existing.title = event.text || existing.title;
    }
    if (event.type === "agent_live") {
      existing.liveText = event.text || existing.liveText;
    }
    if (event.type === "agent_response") {
      existing.responseText = event.text || existing.responseText;
    }
    if (event.type === "step_completed") {
      existing.completedAt = event.at || existing.completedAt;
      existing.summary = event.summary || event.text || existing.summary;
      existing.nextAction = event.nextAction || existing.nextAction;
      existing.state = event.state || existing.state;
      existing.stopReason = event.stopReason || existing.stopReason;
      existing.checkpoint = event.checkpoint || existing.checkpoint;
    }
    if (event.error) {
      existing.error = event.error;
    }
    if (event.checkpoint && !existing.checkpoint) {
      existing.checkpoint = event.checkpoint;
    }
    if (event.summary && !existing.summary) {
      existing.summary = event.summary;
    }
    if (event.nextAction && !existing.nextAction) {
      existing.nextAction = event.nextAction;
    }
    if (event.state && !existing.state) {
      existing.state = event.state;
    }

    steps.set(event.step, existing);
  }

  return [...steps.values()].sort((left, right) => left.step - right.step);
}

function appendDelegateStepField(root, label, value, { emptyText = "" } = {}) {
  const clean = String(value || "").trim();
  if (!clean && !emptyText) {
    return;
  }

  const field = document.createElement("div");
  field.className = "delegate-step-field";

  const labelNode = document.createElement("div");
  labelNode.className = "delegate-step-label";
  labelNode.textContent = label;

  const valueNode = document.createElement("div");
  valueNode.className = "thread-text delegate-step-value";
  renderRichText(valueNode, clean, { emptyText });

  field.append(labelNode, valueNode);
  root.append(field);
}

function usefulDelegateCheckpointText(value) {
  const clean = String(value || "").trim();
  if (!clean || /^(none|n\/a|na|not applicable|no)$/iu.test(clean)) {
    return "";
  }
  return clean;
}

function buildDelegateStepSnapshotCard(snapshot) {
  const card = document.createElement("article");
  card.className = `delegate-step-card${snapshot.error ? " failed" : ""}`;
  card.dataset.delegateLogAnchor = `step:${snapshot.step}`;

  const head = document.createElement("div");
  head.className = "delegate-event-head";

  const title = document.createElement("div");
  title.className = "delegate-event-title";
  title.textContent = `Step ${snapshot.step}`;

  const meta = document.createElement("div");
  meta.className = "delegate-event-meta";
  const finished = formatTimestamp(snapshot.completedAt);
  const started = formatTimestamp(snapshot.startedAt);
  meta.textContent = [
    finished ? `finished ${finished}` : started ? `started ${started}` : "",
    snapshot.state || "in progress",
    `${snapshot.events.length} event${snapshot.events.length === 1 ? "" : "s"}`,
  ].filter(Boolean).join(" • ");

  head.append(title, meta);

  const fields = document.createElement("div");
  fields.className = "delegate-step-fields";
  const checkpoint = snapshot.checkpoint || {};
  const breakthroughText = usefulDelegateCheckpointText(checkpoint.breakthroughs);
  const blockerText = usefulDelegateCheckpointText(checkpoint.blockers);
  const progressText = usefulDelegateCheckpointText(checkpoint.progressSignal);
  const nextProbeText = usefulDelegateCheckpointText(checkpoint.nextProbe);
  appendDelegateStepField(fields, "Completed", snapshot.summary || snapshot.responseText, {
    emptyText: "This step is still running, so the completed snapshot has not landed yet.",
  });
  appendDelegateStepField(fields, "Progress", progressText || delegateStopReasonLabel(snapshot.stopReason) || snapshot.state);
  appendDelegateStepField(fields, "Breakthroughs", breakthroughText);
  appendDelegateStepField(fields, "Blockers", snapshot.error || blockerText);
  appendDelegateStepField(fields, "Next", nextProbeText || snapshot.nextAction || snapshot.title);
  appendDelegateStepField(fields, "Confidence", checkpoint.confidence);
  if (!snapshot.summary && snapshot.liveText) {
    appendDelegateStepField(fields, "Live note", snapshot.liveText);
  }

  card.append(head, fields);
  return card;
}

function buildDelegateLogModeSwitch(activeMode) {
  const wrapper = document.createElement("div");
  wrapper.className = "delegate-log-mode-switch";

  for (const [mode, label] of [
    ["live", "Live"],
    ["steps", "Steps"],
  ]) {
    const button = document.createElement("button");
    button.className = `delegate-log-mode-button${activeMode === mode ? " is-active" : ""}`;
    button.type = "button";
    button.dataset.delegateLogMode = mode;
    button.textContent = label;
    wrapper.append(button);
  }

  return wrapper;
}

function buildDelegateRunSummaryCard(snapshot) {
  const card = document.createElement("article");
  card.className = "summary-card delegate-run-summary-card";

  const copyButton = buildCopyButton({
    copyKey: `delegate-run-summary:${snapshot.id}`,
    label: "Copy run summary",
    text: snapshot.summary,
  });
  card.append(copyButton);

  const head = document.createElement("div");
  head.className = "summary-head";

  const timestamp = document.createElement("div");
  timestamp.className = "summary-timestamp";
  timestamp.textContent = formatTimestamp(snapshot.createdAt) || "Saved run summary";

  const sourceMeta = document.createElement("div");
  sourceMeta.className = "summary-source-meta";
  const sourceCountLabel = `${snapshot.sourceEventCount} event${snapshot.sourceEventCount === 1 ? "" : "s"}`;
  sourceMeta.textContent = `${providerLabel(snapshot.provider)} • ${sourceCountLabel}`;

  head.append(timestamp, sourceMeta);

  const body = document.createElement("div");
  body.className = "thread-text";
  renderRichText(body, snapshot.summary, { emptyText: "No saved run summary yet." });

  card.append(head, body);
  return card;
}

function normalizeArtifact(item) {
  return {
    id: String(item?.id || "").trim() || makeEntryId(),
    projectPath: String(item?.projectPath || "").trim(),
    relativePath: String(item?.relativePath || "").trim(),
    fileName: String(item?.fileName || item?.relativePath || "file").trim(),
    size: Number.parseInt(String(item?.size || "0"), 10) || 0,
    modifiedAt: String(item?.modifiedAt || "").trim() || null,
    mimeType: String(item?.mimeType || "").trim() || "application/octet-stream",
    downloadUrl: String(item?.downloadUrl || "").trim(),
  };
}

function formatFileSize(bytes) {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size >= 10 || unitIndex === 0 ? Math.round(size) : size.toFixed(1)} ${units[unitIndex]}`;
}

function artifactFileName(artifact) {
  return String(artifact?.fileName || artifact?.relativePath || "download").split(/[\\/]/u).pop() || "download";
}

function artifactDownloadUrl(artifact) {
  const url = String(artifact?.downloadUrl || "").trim();
  return url || "";
}

function canAttemptNativeArtifactShare() {
  return Boolean(
    window.isSecureContext &&
      typeof File === "function" &&
      navigator.share &&
      navigator.canShare,
  );
}

function shouldUseNativeArtifactShare() {
  const coarsePointer =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches;
  const standaloneDisplay =
    navigator.standalone === true ||
    (typeof window.matchMedia === "function" &&
      window.matchMedia("(display-mode: standalone)").matches);
  return canAttemptNativeArtifactShare() && (coarsePointer || standaloneDisplay);
}

function triggerDirectArtifactDownload(url, fileName) {
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  link.style.display = "none";
  document.body.append(link);
  link.click();
  link.remove();
}

function fallbackArtifactDownload(url, fileName) {
  try {
    triggerDirectArtifactDownload(url, fileName);
  } catch (_error) {
    window.location.assign(url);
  }
}

async function downloadArtifact(artifact) {
  const url = artifactDownloadUrl(artifact);
  if (!url || state.artifactDownloadPendingId) {
    return;
  }

  const fileName = artifactFileName(artifact);
  const feedbackKey = `artifact-download:${artifact.id}`;

  if (!shouldUseNativeArtifactShare()) {
    fallbackArtifactDownload(url, fileName);
    markCopied(feedbackKey);
    return;
  }

  state.artifactDownloadPendingId = artifact.id;
  renderAll();

  try {
    const response = await fetch(url, { credentials: "same-origin" });
    if (!response.ok) {
      throw new Error(response.statusText || "Download failed");
    }

    const responseType = String(response.headers.get("content-type") || "").trim();
    const artifactType = String(artifact?.mimeType || "").trim();
    const blob = await response.blob();
    const fileType = responseType || artifactType || blob.type || "application/octet-stream";

    if (typeof File === "function" && navigator.share && navigator.canShare) {
      const file = new File([blob], fileName, {
        type: fileType,
        lastModified: Date.parse(artifact?.modifiedAt || "") || Date.now(),
      });
      let canShareFile = false;
      try {
        canShareFile = navigator.canShare({ files: [file] });
      } catch (_error) {
        canShareFile = false;
      }
      if (canShareFile) {
        try {
          await navigator.share({
            files: [file],
            title: fileName,
          });
        } catch (error) {
          if (error?.name === "AbortError") {
            return;
          }
          fallbackArtifactDownload(url, fileName);
        }
        markCopied(feedbackKey);
        return;
      }
    }

    fallbackArtifactDownload(url, fileName);
    markCopied(feedbackKey);
  } catch (error) {
    if (error?.name !== "AbortError") {
      showError(error);
    }
  } finally {
    state.artifactDownloadPendingId = "";
    renderAll();
  }
}

function buildArtifactCard(artifact, { compact = false } = {}) {
  const card = document.createElement("article");
  card.className = `artifact-card${compact ? " is-compact" : ""}`;

  const head = document.createElement("div");
  head.className = "artifact-head";

  const name = document.createElement("div");
  name.className = "artifact-name";
  name.textContent = artifact.fileName;

  const meta = document.createElement("div");
  meta.className = "artifact-meta";
  meta.textContent = [
    formatFileSize(artifact.size),
    formatTimestamp(artifact.modifiedAt),
  ].filter(Boolean).join(" • ");

  head.append(name, meta);

  const pathLabel = document.createElement("div");
  pathLabel.className = "artifact-path";
  pathLabel.textContent = artifact.relativePath;

  const actions = document.createElement("div");
  actions.className = "artifact-actions";

  const downloadKey = `artifact-download:${artifact.id}`;
  const downloadPending = Boolean(state.artifactDownloadPendingId);
  const download = document.createElement("button");
  download.className = "artifact-action-button";
  download.type = "button";
  download.disabled = downloadPending;
  download.textContent =
    state.artifactDownloadPendingId === artifact.id
      ? "Preparing…"
      : copyFeedbackActive(downloadKey)
        ? "Opened"
        : "Download";
  download.addEventListener("click", () => {
    void downloadArtifact(artifact);
  });

  actions.append(download);

  card.append(head, pathLabel);
  card.append(actions);
  return card;
}

function renderArtifactShelf() {
  const project = currentProject();
  const artifactState = artifactsStateFor(project?.path || "");
  const items = Array.isArray(artifactState.items) ? artifactState.items : [];
  const itemCount = items.length;

  if (elements.projectArtifactsOrb) {
    elements.projectArtifactsOrb.hidden = itemCount === 0;
  }
  if (elements.projectArtifactsButton) {
    elements.projectArtifactsButton.title =
      itemCount > 0 ? `${itemCount} agent file${itemCount === 1 ? "" : "s"}` : "Files";
  }

  if (!elements.artifactShelf || !project?.path || (itemCount === 0 && !artifactState.loading)) {
    if (elements.artifactShelf) {
      elements.artifactShelf.hidden = true;
    }
    if (elements.artifactShelfList) {
      clearNode(elements.artifactShelfList);
    }
    return;
  }

  elements.artifactShelf.hidden = false;
  elements.artifactShelf.classList.toggle("is-collapsed", state.artifactShelfCollapsed);
  if (elements.artifactShelfTitle) {
    elements.artifactShelfTitle.textContent = "Agent files";
  }
  if (elements.artifactShelfMeta) {
    elements.artifactShelfMeta.textContent =
      artifactState.loading && !artifactState.initialized
        ? "Checking for downloads"
        : `${itemCount} file${itemCount === 1 ? "" : "s"} ready`;
  }
  if (elements.artifactShelfOpenButton) {
    elements.artifactShelfOpenButton.disabled = !project.path;
  }
  if (elements.artifactShelfToggle) {
    elements.artifactShelfToggle.setAttribute("aria-expanded", String(!state.artifactShelfCollapsed));
    elements.artifactShelfToggle.setAttribute(
      "aria-label",
      state.artifactShelfCollapsed ? "Expand files" : "Collapse files",
    );
  }

  const renderKey = JSON.stringify({
    projectPath: project.path,
    collapsed: state.artifactShelfCollapsed,
    loading: Boolean(artifactState.loading && !artifactState.initialized),
    downloadPendingId: state.artifactDownloadPendingId,
    items: items.slice(0, 3).map((artifact) => [
      artifact.id,
      artifact.relativePath,
      artifact.modifiedAt,
      artifact.size,
      copyFeedbackActive(`artifact-download:${artifact.id}`),
    ]),
  });
  if (elements.artifactShelfList.dataset.renderKey === renderKey) {
    return;
  }

  clearNode(elements.artifactShelfList);
  if (artifactState.loading && !artifactState.initialized) {
    const card = document.createElement("div");
    card.className = "history-state-card artifact-shelf-empty";
    card.textContent = "Checking for files…";
    elements.artifactShelfList.append(card);
  } else {
    for (const artifact of items.slice(0, 3)) {
      elements.artifactShelfList.append(buildArtifactCard(artifact, { compact: true }));
    }
  }
  elements.artifactShelfList.dataset.renderKey = renderKey;
}

function renderArtifactsModal() {
  const project = currentArtifactsProject();
  if (!project) {
    setText(elements.artifactsState, "", { empty: true });
    clearNode(elements.artifactsList);
    elements.artifactsModal.hidden = true;
    return;
  }

  const artifactState = artifactsStateFor(project.path);
  elements.artifactsProject.textContent = project.displayName || project.slug || fallbackProjectLabel(project.path);
  elements.artifactsRoot.textContent =
    artifactState.artifactRoot || `${project.path}/.clawdad/artifacts`;
  const refreshLabel = elements.artifactsRefreshButton.querySelector(".button-text");
  if (refreshLabel) {
    refreshLabel.textContent = artifactState.loading ? "Loading…" : "Refresh";
  }
  elements.artifactsRefreshButton.disabled = artifactState.loading;

  if (artifactState.loading && !artifactState.initialized) {
    setText(elements.artifactsState, "Loading files", { empty: false });
  } else if (artifactState.error) {
    setText(elements.artifactsState, artifactState.error, { empty: false });
  } else if (artifactState.items.length > 0) {
    setText(elements.artifactsState, `${artifactState.items.length} file${artifactState.items.length === 1 ? "" : "s"}`, { empty: false });
  } else {
    setText(elements.artifactsState, "No files yet", { empty: false });
  }

  clearNode(elements.artifactsList);
  if (artifactState.loading && !artifactState.initialized) {
    const card = document.createElement("div");
    card.className = "history-state-card";
    card.textContent = "Looking for files…";
    elements.artifactsList.append(card);
  } else if (artifactState.error) {
    const card = document.createElement("div");
    card.className = "history-state-card";
    card.textContent = artifactState.error;
    elements.artifactsList.append(card);
  } else if (artifactState.items.length === 0) {
    const card = document.createElement("div");
    card.className = "history-state-card";
    card.textContent = "Files agents save into .clawdad/artifacts will show up here.";
    elements.artifactsList.append(card);
  } else {
    for (const artifact of artifactState.items) {
      elements.artifactsList.append(buildArtifactCard(artifact));
    }
  }

  elements.artifactsModal.hidden = false;
}

function renderSummaryModal() {
  const project = currentSummaryProject();
  if (!project) {
    setText(elements.summaryState, "", { empty: true });
    clearNode(elements.summaryList);
    delete elements.summaryList.dataset.renderKey;
    elements.summaryModal.hidden = true;
    return;
  }

  const summaryState = projectSummaryStateFor(project.path);
  const summaryPending = projectSummaryIsPending(summaryState);
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
      ? `${sessionOptionLabel(summarySession, project.path)} • snapshots`
      : "Project snapshots";

  const refreshButtonLabel = elements.summaryRefreshButton.querySelector(".button-text");
  if (refreshButtonLabel) {
    refreshButtonLabel.textContent = summaryPending ? "Refreshing…" : "New summary";
  }
  elements.summaryRefreshButton.disabled =
    summaryPending || !project.path || !summarySession?.sessionId;

  if (summaryPending) {
    setText(elements.summaryState, "Refreshing summary", { empty: false });
  } else if (summaryState.summaryStatus?.state === "failed" && summaryState.summaryStatus.error) {
    setText(elements.summaryState, summaryState.summaryStatus.error, { empty: false });
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

  const summaryListRenderKey = JSON.stringify({
    projectPath: project.path,
    pending: summaryPending,
    loading: Boolean(summaryState.loading && !summaryState.initialized),
    error: summaryState.error || "",
    snapshots: summaryState.snapshots.map((snapshot) => [
      snapshot.id,
      snapshot.createdAt,
      String(snapshot.summary || "").length,
    ]),
  });
  if (elements.summaryList.dataset.renderKey !== summaryListRenderKey) {
    clearNode(elements.summaryList);
    if (summaryPending && summaryState.snapshots.length === 0) {
      const card = document.createElement("div");
      card.className = "history-state-card";
      card.textContent = "Working on a fresh summary…";
      elements.summaryList.append(card);
    } else if (!summaryState.initialized && summaryState.loading) {
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
    elements.summaryList.dataset.renderKey = summaryListRenderKey;
  }

  elements.summaryModal.hidden = false;
}

function renderDelegateModal() {
  const project = currentDelegateProject();
  if (!project) {
    setText(elements.delegateState, "", { empty: true });
    if (elements.delegateOverview) {
      clearNode(elements.delegateOverview);
    }
    clearNode(elements.delegateRunCardList);
    clearNode(elements.delegateRunList);
    if (elements.delegateReviewList) {
      clearNode(elements.delegateReviewList);
    }
    if (elements.delegateSummaryList) {
      clearNode(elements.delegateSummaryList);
    }
    if (elements.delegatePlanList) {
      clearNode(elements.delegatePlanList);
    }
    clearNode(elements.delegateCarouselTabs);
    if (elements.delegateCarouselTitle) {
      elements.delegateCarouselTitle.textContent = "";
    }
    if (elements.delegateCarouselMeta) {
      elements.delegateCarouselMeta.textContent = "";
    }
    elements.delegateModal.hidden = true;
    return;
  }

  const delegateState = delegateStateFor(project.path);
  const status = delegateState.status;
  const latestPlan = delegateState.latestPlanSnapshot;
  const delegateSession = delegateState.delegateSession;
  const runLog = delegateState.runLog || {};
  const feed = delegateState.feed || {};
  const runSummarySnapshots = Array.isArray(delegateState.runSummarySnapshots)
    ? delegateState.runSummarySnapshots
    : [];
  const runCards = delegateRunCardData(delegateState, runLog);
  const runId = selectedDelegateRunId(project.path, delegateState);
  const delegateLogMode = delegateLogModeFor(project.path);

  elements.delegateProject.textContent =
    project.displayName || project.slug || fallbackProjectLabel(project.path);
  elements.delegateSession.textContent =
    delegateSession?.label || "Delegate session will be created on first use";

  const saveButtonLabel = elements.delegateSaveButton.querySelector(".button-text");
  if (saveButtonLabel) {
    saveButtonLabel.textContent = state.delegateBriefPending ? "Saving…" : "Save";
  }

  if (elements.delegatePlanButton) {
    const planButtonLabel = elements.delegatePlanButton.querySelector(".button-text");
    if (planButtonLabel) {
      planButtonLabel.textContent =
        state.delegatePlanPending || status?.state === "planning" ? "Planning…" : "Plan";
    }
  }

  const runButtonLabel = elements.delegateRunButton.querySelector(".button-text");
  if (runButtonLabel) {
    if (state.delegateRunPending) {
      runButtonLabel.textContent = "Working…";
    } else if (status?.pauseRequested) {
      runButtonLabel.textContent = "Keep Going";
    } else if (status?.state === "running") {
      runButtonLabel.textContent = "Pause";
    } else {
      runButtonLabel.textContent = "Auto";
    }
  }
  const runButtonIcon = elements.delegateRunButton.querySelector(".auto-icon");
  if (runButtonIcon) {
    runButtonIcon.textContent =
      state.delegateRunPending || status?.state === "running" ? "" : delegateAutoIcon;
    runButtonIcon.hidden = !runButtonIcon.textContent;
  }

  elements.delegateSaveButton.disabled = state.delegateBriefPending || !state.delegateBriefDirty;
  if (elements.delegatePlanButton) {
    elements.delegatePlanButton.disabled =
      state.delegateBriefPending ||
      state.delegatePlanPending ||
      state.delegateRunPending ||
      status?.state === "running";
  }
  elements.delegateRunButton.disabled =
    state.delegatePlanPending || state.delegateRunPending || !project.path;
  if (elements.delegateSummaryButton) {
    elements.delegateSummaryButton.disabled =
      state.delegateRunSummaryPending || !runId || (runLog.events || []).length === 0;
    elements.delegateSummaryButton.classList.toggle("is-loading", state.delegateRunSummaryPending);
  }

  const desiredBrief = state.delegateBriefDirty ? state.delegateBriefDraft : delegateState.brief || "";
  if (
    elements.delegateBriefInput.value !== desiredBrief &&
    (!state.delegateBriefDirty || document.activeElement !== elements.delegateBriefInput)
  ) {
    elements.delegateBriefInput.value = desiredBrief;
  }

  if (state.delegateBriefPending) {
    setText(elements.delegateState, "Saving", { empty: false });
  } else if (state.delegatePlanPending || status?.state === "planning") {
    setText(elements.delegateState, "Planning", { empty: false });
  } else if (status?.state === "running") {
    const stepLabel = status.maxSteps > 0 ? `${status.stepCount}/${status.maxSteps}` : status.stepCount;
    setText(
      elements.delegateState,
      status.pauseRequested ? `Pausing • ${stepLabel}` : `Running • ${stepLabel}`,
      { empty: false },
    );
  } else if (status?.state === "blocked") {
    setText(
      elements.delegateState,
      delegateStopReasonLabel(status.stopReason) || "Blocked",
      { empty: false },
    );
  } else if (status?.state === "completed") {
    setText(elements.delegateState, "Done", { empty: false });
  } else if (status?.state === "failed" && status.error) {
    setText(elements.delegateState, "Failed", { empty: false });
  } else if (delegateState.error) {
    setText(elements.delegateState, "Error", { empty: false });
  } else if (!delegateState.initialized && delegateState.loading) {
    setText(elements.delegateState, "Loading", { empty: false });
  } else if (latestPlan?.createdAt) {
    setText(elements.delegateState, "Ready", { empty: false });
  } else {
    setText(elements.delegateState, "No plan", { empty: false });
  }

  const logMatchesSelection = !runId || runLog.runId === runId;
  const eventCount = logMatchesSelection && Array.isArray(runLog.events) ? runLog.events.length : 0;
  if (elements.delegateOverview) {
    clearNode(elements.delegateOverview);
  }

  clearNode(elements.delegateRunCardList);
  if (!delegateState.initialized && delegateState.loading) {
    const card = document.createElement("div");
    card.className = "history-state-card";
    card.textContent = "Loading auto history...";
    elements.delegateRunCardList.append(card);
  } else if (runCards.length === 0) {
    const card = document.createElement("div");
    card.className = "history-state-card";
    card.textContent = "No auto history yet.";
    elements.delegateRunCardList.append(card);
  } else {
    for (const run of runCards) {
      elements.delegateRunCardList.append(buildDelegateRunCard(run, { selected: run.runId === runId }));
    }
  }

  renderDelegateCarouselChrome();

  const runKey = delegateRunKey(project.path, runId);
  const renderKey = delegateRunRenderSignature(runLog, { logMode: delegateLogMode });
  const existingRunKey = elements.delegateRunList.dataset.runKey || "";
  const existingRenderKey = elements.delegateRunList.dataset.renderKey || "";
  if (existingRunKey !== runKey || existingRenderKey !== renderKey) {
    const scrollSnapshot =
      delegateRunRenderSnapshot?.runKey === runKey
        ? delegateRunRenderSnapshot
        : existingRunKey === runKey
          ? captureDelegateRunSnapshot(runKey, "smart")
          : null;
    delegateRunRenderSnapshot = null;

    clearNode(elements.delegateRunList);
    elements.delegateRunList.append(buildDelegateLogModeSwitch(delegateLogMode));
    if (!runLog.initialized && runLog.loading) {
      const card = document.createElement("div");
      card.className = "history-state-card";
      card.textContent = "Loading run log…";
      elements.delegateRunList.append(card);
    } else if (runLog.error) {
      const card = document.createElement("div");
      card.className = "history-state-card";
      card.textContent = runLog.error;
      elements.delegateRunList.append(card);
    } else if (!runId) {
      const card = document.createElement("div");
      card.className = "history-state-card";
      card.textContent = "Choose an auto session to see its log.";
      elements.delegateRunList.append(card);
    } else if (!logMatchesSelection || (runLog.loading && !runLog.initialized)) {
      const card = document.createElement("div");
      card.className = "history-state-card";
      card.textContent = "Loading run log...";
      elements.delegateRunList.append(card);
    } else if (eventCount === 0) {
      const card = document.createElement("div");
      card.className = "history-state-card";
      card.textContent = runLog.loading ? "Waiting for run events…" : "No run events yet.";
      elements.delegateRunList.append(card);
    } else if (delegateLogMode === "steps") {
      const snapshots = delegateStepSnapshots(runLog.events);
      if (snapshots.length === 0) {
        const card = document.createElement("div");
        card.className = "history-state-card";
        card.textContent = "No step snapshots captured yet.";
        elements.delegateRunList.append(card);
      } else {
        for (const snapshot of snapshots) {
          elements.delegateRunList.append(buildDelegateStepSnapshotCard(snapshot));
        }
      }
    } else {
      elements.delegateRunList.append(buildDelegateLiveCurrentCard(delegateState, runLog, runLog.events));
      for (const event of runLog.events.slice(-40)) {
        elements.delegateRunList.append(buildDelegateRunEventCard(event, {
          compact: event.type !== "agent_live" && event.type !== "agent_response",
          live: event.type === "agent_live",
        }));
      }
    }
    elements.delegateRunList.dataset.runKey = runKey;
    elements.delegateRunList.dataset.renderKey = renderKey;
    applyDelegateRunSnapshot(scrollSnapshot);
  }

  if (elements.delegateReviewList) {
    const cards = Array.isArray(feed.cards) ? feed.cards : [];
    const feedRenderKey = JSON.stringify({
      projectPath: project.path,
      loading: Boolean(feed.loading && !feed.initialized),
      error: feed.error || "",
      cards: cards.map((card) => [card.id, card.reviewStatus, card.at, card.title]),
    });
    if (elements.delegateReviewList.dataset.renderKey !== feedRenderKey) {
      clearNode(elements.delegateReviewList);
      if (feed.loading && !feed.initialized) {
        const card = document.createElement("div");
        card.className = "history-state-card";
        card.textContent = "Scanning review feed...";
        elements.delegateReviewList.append(card);
      } else if (feed.error) {
        const card = document.createElement("div");
        card.className = "history-state-card";
        card.textContent = feed.error;
        elements.delegateReviewList.append(card);
      } else if (cards.length === 0) {
        const card = document.createElement("div");
        card.className = "history-state-card";
        card.textContent = "No review cards yet.";
        elements.delegateReviewList.append(card);
      } else {
        for (const card of cards) {
          elements.delegateReviewList.append(buildWatchtowerReviewCard(card));
        }
      }
      elements.delegateReviewList.dataset.renderKey = feedRenderKey;
    }
  }

  if (elements.delegateSummaryList) {
    clearNode(elements.delegateSummaryList);
  }
  if (elements.delegatePlanList) {
    clearNode(elements.delegatePlanList);
  }

  elements.delegateModal.hidden = false;
}

function projectIsBusy(project) {
  const projectStatus = String(project?.status || "").trim().toLowerCase();
  return projectStatus === "running" || projectStatus === "dispatched";
}

function catalogIsBootstrapping() {
  return state.projectsLoading && state.projects.length === 0;
}

function updateMailboxState() {
  const pending = pendingEntryForSession(state.selectedProject, state.selectedSessionId);
  if (pending) {
    setText(elements.mailboxState, currentProcessingPhrase(), { empty: false });
    return;
  }

  const project = currentProject();
  const session = currentSession();
  if (session?.pendingCreation) {
    setText(elements.mailboxState, "setting up", { empty: false });
    return;
  }
  if (sessionIsBusy(session)) {
    setText(elements.mailboxState, currentProcessingPhrase(), { empty: false });
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
    setText(elements.mailboxState, "cajun butter", { empty: false });
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
  const session = currentSession();
  const hasPending = Boolean(pendingEntryForSession(state.selectedProject, state.selectedSessionId));
  const sessionBusy = hasPending || sessionIsBusy(session);
  const catalogBlocking = catalogIsBootstrapping();
  const canSend =
    !catalogBlocking &&
    !state.dispatchPending &&
    !state.sessionSwitchPending &&
    Boolean(state.selectedProject) &&
    Boolean(state.selectedSessionId) &&
    !sessionBusy;

  elements.dispatchButton.disabled = !canSend;
  elements.dispatchButton.querySelector(".button-text").textContent = state.dispatchPending
    ? "Sending…"
    : catalogBlocking
      ? "Loading…"
      : sessionBusy
      ? `${currentProcessingPhrase()}…`
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

function updateDelegateButtonAvailability() {
  elements.projectDelegateButton.disabled = state.projectsLoading || !state.selectedProject;
}

function updateArtifactsButtonAvailability() {
  elements.projectArtifactsButton.disabled = state.projectsLoading || !state.selectedProject;
}

function updateImportButtonAvailability() {
  const projectPath = state.selectedProject;
  const importState = importableSessionsStateFor(projectPath);
  elements.sessionImportButton.disabled =
    state.projectsLoading ||
    state.sessionSwitchPending ||
    !projectPath ||
    Boolean(currentSession()?.pendingCreation);
  if (elements.sessionImportOrb) {
    elements.sessionImportOrb.hidden = !(Array.isArray(importState.items) && importState.items.length > 0);
  }
}

function updateSessionRenameAvailability() {
  const session = currentSession();
  elements.sessionRenameButton.disabled =
    state.projectsLoading ||
    state.sessionSwitchPending ||
    !state.selectedProject ||
    !session?.sessionId ||
    Boolean(session?.pendingCreation) ||
    sessionRenamePending(state.selectedProject, session?.sessionId);
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
  updateProjectControlAppearance();
  renderSessionOptions();
  renderQueueList();
  renderArtifactShelf();
  renderModal();
  renderSessionImportModal();
  renderSessionTitleModal();
  renderSummaryModal();
  renderArtifactsModal();
  renderDelegateModal();
  renderProjectModal();
  updateMailboxState();
  updateQueueUnreadOrb();
  updateSendAvailability();
  updateThreadButtonAvailability();
  updateImportButtonAvailability();
  updateSessionRenameAvailability();
  updateSummaryButtonAvailability();
  updateArtifactsButtonAvailability();
  updateDelegateButtonAvailability();
  updateQueueChrome();
  updateBodyModalState();
  refreshCopyButtons();
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

        completeThreadEntry(entry, {
          status: status === "completed" ? "answered" : "failed",
          sessionId: mailboxCompletionFallbackSession.sessionId || entry.sessionId,
          sessionLabel: sessionOptionLabel(
            mailboxCompletionFallbackSession,
            entry.projectPath,
          ),
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
        completeThreadEntry(entry, {
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
        if (entryAgePastAttachGraceWindow(entry) && status !== "running" && status !== "dispatched") {
          completeThreadEntry(entry, {
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
        Date.now() - sentAtMs > queuedDispatchAttachGraceMs &&
        (!Number.isFinite(lastDispatchMs) || lastDispatchMs < sentAtMs)
      ) {
        completeThreadEntry(entry, {
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
        if (entryAgePastAttachGraceWindow(entry)) {
          completeThreadEntry(entry, {
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

    completeThreadEntry(entry, {
      status: status === "completed" ? "answered" : "failed",
      answeredAt: session?.lastResponse || project?.lastResponse || new Date().toISOString(),
      requestId: effectiveRequestId || liveRequestId || trackedRequestId,
      response: readsByRequest.get(readKey) || (status === "failed" ? "Failed." : ""),
      seenAt: null,
    });
  }

  renderAll();
  void refreshArtifacts().catch(() => {});

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
      state.projects = Array.isArray(payload.projects)
        ? payload.projects.map(hydrateProjectVisuals).sort(compareProjects)
        : [];
      syncSelectedProject(payload.defaultProject || state.selectedProject);
      syncSelectedSession(state.selectedSessionId);
      cacheProjects(payload);
      await reconcileThreadEntries();
      hydrateReturnedThreadEntries({ prefetch: true });
      if (state.selectedProject) {
        void refreshImportableSessions(state.selectedProject).catch(() => {});
        void loadProjectArtifacts(state.selectedProject, { quiet: true }).catch(() => {});
      }
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

function summaryProjectsNeedingRefresh() {
  const targets = new Set();
  if (state.summaryModalProject) {
    targets.add(state.summaryModalProject);
  }

  for (const [projectPath, summaryState] of Object.entries(state.projectSummaries)) {
    if (projectSummaryIsPending(summaryState)) {
      targets.add(projectPath);
    }
  }

  return [...targets].filter(Boolean);
}

async function refreshProjectSummaries() {
  if (state.summaryRefreshPromise) {
    return state.summaryRefreshPromise;
  }

  const targets = summaryProjectsNeedingRefresh();
  if (targets.length === 0) {
    return;
  }

  state.summaryRefreshPromise = Promise.all(
    targets.map((projectPath) => loadProjectSummary(projectPath, { force: true })),
  ).finally(() => {
    state.summaryRefreshPromise = null;
  });

  return state.summaryRefreshPromise;
}

function delegateProjectsNeedingRefresh() {
  const targets = new Set();
  if (state.delegateModalProject) {
    targets.add(state.delegateModalProject);
  }

  for (const [projectPath, delegateState] of Object.entries(state.delegatesByProject)) {
    const delegateStatus = delegateState?.status?.state;
    if (delegateStatus === "planning" || delegateStatus === "running") {
      targets.add(projectPath);
    }
  }

  return [...targets].filter(Boolean);
}

async function refreshDelegates() {
  if (state.delegateRefreshPromise) {
    return state.delegateRefreshPromise;
  }

  const targets = delegateProjectsNeedingRefresh();
  if (targets.length === 0) {
    return;
  }

  state.delegateRefreshPromise = Promise.all(
    targets.map((projectPath) => loadDelegateProject(projectPath, { force: true })),
  ).finally(() => {
    state.delegateRefreshPromise = null;
  });

  return state.delegateRefreshPromise;
}

function artifactProjectsNeedingRefresh() {
  const targets = new Set();
  if (state.selectedProject) {
    targets.add(state.selectedProject);
  }
  if (state.artifactModalProject) {
    targets.add(state.artifactModalProject);
  }
  if (state.delegateModalProject) {
    targets.add(state.delegateModalProject);
  }

  for (const [projectPath, delegateState] of Object.entries(state.delegatesByProject)) {
    const delegateStatus = delegateState?.status?.state;
    if (delegateStatus === "planning" || delegateStatus === "running") {
      targets.add(projectPath);
    }
  }

  for (const entry of state.threadEntries) {
    if (entry.status === "queued" || entry.status === "answered") {
      targets.add(entry.projectPath);
    }
  }

  return [...targets].filter(Boolean);
}

async function refreshArtifacts({ force = true } = {}) {
  const targets = artifactProjectsNeedingRefresh();
  if (targets.length === 0) {
    return;
  }

  await Promise.all(
    targets.map((projectPath) => loadProjectArtifacts(projectPath, { force, quiet: true })),
  );
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

  const modalThread = currentModalThread();
  const sameOpenThread =
    modalThread?.projectPath === projectPath && modalThread?.sessionId === sessionId;

  setHistoryState(projectPath, sessionId, {
    loading: true,
    error: "",
    initialized: existing.initialized,
  });
  renderAll();

  try {
    const payload = await fetchJson(
      `/v1/history?project=${encodeURIComponent(projectPath)}&sessionId=${encodeURIComponent(sessionId)}&cursor=${encodeURIComponent(cursor || "0")}&limit=${historyPageSize}`,
    );
    const pageItems = (Array.isArray(payload.items) ? payload.items : [])
      .map(normalizeHistoryItem)
      .reverse();
    const localItems = state.threadEntries
      .filter(
        (entry) =>
          entry.projectPath === projectPath && entry.sessionId === sessionId,
      )
      .map(historyItemFromThreadEntry)
      .filter(Boolean);

    const nextItems = reset
      ? mergeHistoryItems(pageItems, localItems)
      : appendOlder
        ? mergeHistoryItems(pageItems, existing.items)
        : mergeHistoryItems(pageItems, localItems);

    if (sameOpenThread) {
      queueDetailHistorySnapshot(
        captureDetailHistorySnapshot(
          historyKey(projectPath, sessionId),
          appendOlder ? "prepend-older" : stickToBottom ? "bottom" : "smart",
        ),
      );
    }

    setHistoryState(projectPath, sessionId, {
      items: nextItems,
      nextCursor: payload.nextCursor || null,
      loading: false,
      initialized: true,
      prefetchedAt: Date.now(),
      error: "",
    });
    renderAll();
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

async function prefetchSessionHistory(projectPath, sessionId, { force = false } = {}) {
  if (!projectPath || !sessionId) {
    return historyStateFor(projectPath, sessionId);
  }

  const key = historyKey(projectPath, sessionId);
  if (state.historyPrefetchPromises[key]) {
    return state.historyPrefetchPromises[key];
  }

  const existing = historyStateFor(projectPath, sessionId);
  const prefetchedAt = Number(existing.prefetchedAt || 0);
  if (
    !force &&
    prefetchedAt > 0 &&
    Date.now() - prefetchedAt < historyPrefetchFreshMs &&
    !existing.loading
  ) {
    return existing;
  }

  state.historyPrefetchPromises[key] = loadSessionHistory(projectPath, sessionId, {
    reset: true,
  })
    .catch(() => historyStateFor(projectPath, sessionId))
    .finally(() => {
      delete state.historyPrefetchPromises[key];
    });

  return state.historyPrefetchPromises[key];
}

async function refreshForegroundState() {
  if (document.visibilityState === "hidden") {
    return;
  }
  if (state.foregroundRefreshPromise) {
    return state.foregroundRefreshPromise;
  }

  state.foregroundRefreshPromise = (async () => {
    await refreshProjects();

    const modalThread = currentModalThread();
    if (modalThread?.projectPath && modalThread?.sessionId) {
      await loadSessionHistory(modalThread.projectPath, modalThread.sessionId, {
        reset: true,
        stickToBottom: !modalThread.focusRequestId,
      });
    }

    await refreshProjectSummaries();
    await refreshDelegates();
    await refreshArtifacts();
  })()
    .catch((error) => {
      console.warn("[clawdad] foreground refresh failed", error);
    })
    .finally(() => {
      state.foregroundRefreshPromise = null;
    });

  return state.foregroundRefreshPromise;
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

  state.sessionImportModalProject = "";
  state.summaryModalProject = "";
  state.artifactModalProject = "";
  state.delegateModalProject = "";
  state.sessionTitleModalProject = "";
  state.sessionTitleModalSessionId = "";
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
  if (existing.loading) {
    return existing;
  }
  if (!force && (existing.initialized || projectSummaryIsPending(existing))) {
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
      pending: payload.summaryStatus?.state === "running",
      latestSnapshot: payload.latestSnapshot
        ? normalizeProjectSummarySnapshot(payload.latestSnapshot)
        : null,
      snapshots: Array.isArray(payload.snapshots)
        ? payload.snapshots.map(normalizeProjectSummarySnapshot)
        : [],
      summaryStatus: payload.summaryStatus
        ? normalizeProjectSummaryStatus(payload.summaryStatus)
        : null,
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
  state.sessionImportModalProject = "";
  state.artifactModalProject = "";
  state.delegateModalProject = "";
  state.sessionTitleModalProject = "";
  state.sessionTitleModalSessionId = "";
  state.summaryModalProject = projectPath;
  renderAll();
  await loadProjectSummary(projectPath);
}

function closeProjectSummary() {
  state.summaryModalProject = "";
  renderAll();
}

async function loadProjectArtifacts(projectPath, { force = false, quiet = false } = {}) {
  if (!projectPath) {
    return artifactsStateFor(projectPath);
  }

  if (state.artifactRefreshPromises[projectPath]) {
    return state.artifactRefreshPromises[projectPath];
  }

  const existing = artifactsStateFor(projectPath);
  if (existing.loading) {
    return existing;
  }
  if (!force && existing.initialized) {
    return existing;
  }

  const showLoading = !quiet || !existing.initialized;
  if (showLoading) {
    setArtifactsState(projectPath, {
      loading: true,
      error: "",
    });
    renderAll();
  } else {
    setArtifactsState(projectPath, {
      loading: true,
      error: "",
    });
  }

  state.artifactRefreshPromises[projectPath] = (async () => {
    const payload = await fetchJson(`/v1/artifacts?project=${encodeURIComponent(projectPath)}`);
    setArtifactsState(projectPath, {
      loading: false,
      initialized: true,
      error: "",
      artifactRoot: String(payload.artifactRoot || ""),
      items: Array.isArray(payload.artifacts) ? payload.artifacts.map(normalizeArtifact) : [],
    });
    return artifactsStateFor(projectPath);
  })()
    .catch((error) => {
      setArtifactsState(projectPath, {
        loading: false,
        initialized: true,
        error: error.message,
      });
      return artifactsStateFor(projectPath);
    })
    .finally(() => {
      delete state.artifactRefreshPromises[projectPath];
      renderAll();
    });

  return state.artifactRefreshPromises[projectPath];
}

async function openArtifactsModal(projectPath = state.selectedProject) {
  if (!projectPath) {
    return;
  }

  state.modalThread = null;
  state.projectModalOpen = false;
  state.sessionImportModalProject = "";
  state.summaryModalProject = "";
  state.delegateModalProject = "";
  state.sessionTitleModalProject = "";
  state.sessionTitleModalSessionId = "";
  state.artifactModalProject = projectPath;
  renderAll();
  await loadProjectArtifacts(projectPath, { force: true });
}

function closeArtifactsModal() {
  state.artifactModalProject = "";
  renderAll();
}

function closeSessionTitleModal() {
  state.sessionTitleModalProject = "";
  state.sessionTitleModalSessionId = "";
  state.sessionTitleDraft = "";
  state.sessionTitleConfirmRemove = false;
  state.sessionTitlePending = false;
  state.sessionTitleError = "";
  renderAll();
}

function closeSessionImportModal() {
  state.sessionImportModalProject = "";
  state.sessionImportPendingId = "";
  renderAll();
}

async function openSessionImportModal(projectPath = state.selectedProject) {
  const project = projectByPath(projectPath);
  if (!project?.path) {
    return;
  }

  state.modalThread = null;
  state.projectModalOpen = false;
  state.summaryModalProject = "";
  state.artifactModalProject = "";
  state.delegateModalProject = "";
  state.sessionTitleModalProject = "";
  state.sessionTitleModalSessionId = "";
  state.sessionImportModalProject = project.path;
  state.sessionImportPendingId = "";
  renderAll();

  try {
    await refreshImportableSessions(project.path, { force: true });
  } catch (_error) {
    renderAll();
  }
}

function openSessionTitleModal(projectPath = state.selectedProject, sessionId = state.selectedSessionId) {
  const project = projectByPath(projectPath);
  const session =
    project?.sessions?.find((item) => item.sessionId === sessionId) || null;
  if (!project || !session?.sessionId || session.pendingCreation) {
    return;
  }

  state.modalThread = null;
  state.projectModalOpen = false;
  state.sessionImportModalProject = "";
  state.summaryModalProject = "";
  state.artifactModalProject = "";
  state.delegateModalProject = "";
  state.sessionTitleModalProject = project.path;
  state.sessionTitleModalSessionId = session.sessionId;
  state.sessionTitleDraft = sessionDisplayTitle(session, project.path);
  state.sessionTitleConfirmRemove = false;
  state.sessionTitlePending = false;
  state.sessionTitleError = "";
  renderAll();

  window.requestAnimationFrame(() => {
    elements.sessionTitleInput?.focus();
    elements.sessionTitleInput?.select();
  });
}

async function handleSessionImport(sessionId) {
  const project = currentSessionImportProject() || currentProject();
  if (!project?.path || !sessionId || state.sessionImportPendingId) {
    return;
  }

  state.sessionImportPendingId = sessionId;
  renderAll();

  try {
    const payload = await fetchJson("/v1/import-session", {
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
      upsertProject(payload.projectDetails);
      state.selectedProject = payload.projectDetails.path;
      syncSelectedSession(payload.sessionId || sessionId, { preferCurrent: false });
    } else {
      await refreshProjects();
      syncSelectedSession(sessionId, { preferCurrent: false });
    }

    const importState = importableSessionsStateFor(project.path);
    setImportableSessionsState(project.path, {
      items: (importState.items || []).filter((item) => item.sessionId !== sessionId),
      loading: false,
      initialized: true,
      loadedAt: Date.now(),
      error: "",
      promise: null,
    });
    closeSessionImportModal();
  } catch (error) {
    state.sessionImportPendingId = "";
    setImportableSessionsState(project.path, {
      error: error.message,
      loading: false,
      initialized: true,
      promise: null,
    });
    renderAll();
    showError(error);
  }
}

async function handleSessionTitleSubmit(event) {
  event.preventDefault();

  const { project, session } = currentSessionTitleTarget();
  const title = state.sessionTitleDraft.trim();
  if (!project || !session?.sessionId) {
    return;
  }

  if (!title) {
    state.sessionTitleError = "Choose a title.";
    renderAll();
    return;
  }

  const previousLabel = sessionOptionLabel(session, project.path);
  const currentTitle = sessionDisplayTitle(session, project.path);
  if (title === currentTitle) {
    closeSessionTitleModal();
    return;
  }

  setPendingSessionRename(project.path, session.sessionId, {
    title,
    startedAt: new Date().toISOString(),
  });
  const optimisticLabel = sessionOptionLabel(session, project.path);
  updateThreadEntrySessionLabels(project.path, session.sessionId, optimisticLabel);
  closeSessionTitleModal();

  void (async () => {
    try {
      const payload = await fetchJson("/v1/session-title", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          project: project.path,
          sessionId: session.sessionId,
          title,
        }),
      });

      setPendingSessionRename(project.path, session.sessionId, null);

      if (payload.projectDetails) {
        replaceProject(payload.projectDetails);
        if (state.selectedProject === project.path) {
          syncSelectedSession(session.sessionId, { preferCurrent: false });
        }
      } else {
        await refreshProjects();
      }

      const refreshedSession =
        projectByPath(project.path)?.sessions?.find((item) => item.sessionId === session.sessionId) ||
        null;
      updateThreadEntrySessionLabels(
        project.path,
        session.sessionId,
        refreshedSession ? sessionOptionLabel(refreshedSession, project.path) : optimisticLabel,
      );
      renderAll();
    } catch (error) {
      setPendingSessionRename(project.path, session.sessionId, null);
      updateThreadEntrySessionLabels(project.path, session.sessionId, previousLabel);
      renderAll();
      showError(error);
    }
  })();
}

function handleSessionRemove() {
  const { project, session } = currentSessionTitleTarget();
  if (!project || !session?.sessionId) {
    return;
  }

  if (!state.sessionTitleConfirmRemove) {
    state.sessionTitleConfirmRemove = true;
    state.sessionTitleError = "";
    renderAll();
    return;
  }

  const projectPath = project.path;
  const sessionId = session.sessionId;
  const shouldResyncCurrentProject = state.selectedProject === projectPath;

  closeSessionTitleModal();

  void (async () => {
    try {
      const payload = await fetchJson("/v1/session-delete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          project: projectPath,
          sessionId,
        }),
      });

      pruneTrackedArtifacts(projectPath, sessionId);

      if (payload.projectDetails) {
        replaceProject(payload.projectDetails);
      } else {
        removeProject(projectPath);
      }

      if (shouldResyncCurrentProject) {
        syncSelectedProject(projectPath, { preferCurrent: true });
        syncSelectedSession("", { preferCurrent: true });
      } else {
        syncSelectedProject("", { preferCurrent: true });
        syncSelectedSession("", { preferCurrent: true });
      }

      renderAll();
    } catch (error) {
      void refreshProjects().catch(showError);
      showError(error);
    }
  })();
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
    summaryStatus: normalizeProjectSummaryStatus({
      state: "running",
      projectPath: project.path,
      sessionId: session.sessionId,
      provider: session.provider,
      sessionLabel: sessionOptionLabel(session, project.path),
      startedAt: new Date().toISOString(),
    }),
    summarySession: {
      sessionId: session.sessionId,
      provider: session.provider,
      label: sessionOptionLabel(session, project.path),
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
      pending: payload.summaryStatus?.state === "running",
      loading: false,
      initialized: true,
      error: "",
      latestSnapshot: payload.latestSnapshot
        ? normalizeProjectSummarySnapshot(payload.latestSnapshot)
        : null,
      snapshots: Array.isArray(payload.snapshots)
        ? payload.snapshots.map(normalizeProjectSummarySnapshot)
        : [],
      summaryStatus: payload.summaryStatus
        ? normalizeProjectSummaryStatus(payload.summaryStatus)
        : null,
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

function mergeDelegateRunEvents(existingEvents = [], incomingEvents = []) {
  const eventsById = new Map();
  for (const event of [...existingEvents, ...incomingEvents]) {
    if (!event?.id) {
      continue;
    }
    eventsById.set(event.id, event);
  }
  return [...eventsById.values()].sort((left, right) => {
    const leftMs = Date.parse(left.at || "");
    const rightMs = Date.parse(right.at || "");
    return (Number.isFinite(leftMs) ? leftMs : 0) - (Number.isFinite(rightMs) ? rightMs : 0);
  });
}

async function loadDelegateRunLog(projectPath, { force = false, reset = false, runId: requestedRunId = "" } = {}) {
  if (!projectPath) {
    return delegateStateFor(projectPath).runLog;
  }

  const existing = delegateStateFor(projectPath);
  const statusRunId = existing.status?.runId || "";
  const existingRunId = existing.runLog?.runId || "";
  const selectedRunIdValue = state.delegateSelectedRunIds[projectPath] || "";
  const runId = String(requestedRunId || selectedRunIdValue || statusRunId || existingRunId).trim();
  if (!runId) {
    setDelegateState(projectPath, {
      runLog: {
        runId: "",
        events: [],
        nextCursor: "0",
        total: 0,
        loading: false,
        initialized: true,
        error: "",
      },
    });
    return delegateStateFor(projectPath).runLog;
  }

  if (existing.runLog?.loading) {
    return existing.runLog;
  }
  state.delegateSelectedRunIds[projectPath] = runId;
  const runChanged = Boolean(existingRunId && existingRunId !== runId);
  const shouldReset = reset || runChanged;
  if (
    !force &&
    existing.runLog?.initialized &&
    !runChanged &&
    String(existing.runLog?.nextCursor || "0") === String(existing.runLog?.total || 0)
  ) {
    return existing.runLog;
  }

  const showLoadingState = shouldReset || !existing.runLog?.initialized;
  setDelegateState(projectPath, {
    runLog: {
      ...(existing.runLog || {}),
      runId,
      loading: true,
      error: "",
    },
  });
  if (showLoadingState) {
    renderAll();
  }

  try {
    const cursor = shouldReset || !existing.runLog?.initialized
      ? "tail"
      : String(existing.runLog?.nextCursor || "0");
    const payload = await fetchJson(
      `/v1/delegate/run-log?project=${encodeURIComponent(projectPath)}&runId=${encodeURIComponent(runId)}&cursor=${encodeURIComponent(cursor)}`,
    );
    const incomingEvents = Array.isArray(payload.events)
      ? payload.events.map(normalizeDelegateRunEvent)
      : [];
    const keptEvents = shouldReset ? [] : existing.runLog?.events || [];
    setDelegateState(projectPath, {
      runList: Array.isArray(payload.delegateRuns)
        ? payload.delegateRuns.map(normalizeDelegateRunInfo)
        : delegateStateFor(projectPath).runList,
      latestRunSummarySnapshot: payload.latestRunSummarySnapshot
        ? normalizeDelegateRunSummarySnapshot(payload.latestRunSummarySnapshot)
        : delegateStateFor(projectPath).latestRunSummarySnapshot,
      runSummarySnapshots: Array.isArray(payload.runSummarySnapshots)
        ? payload.runSummarySnapshots.map(normalizeDelegateRunSummarySnapshot)
        : delegateStateFor(projectPath).runSummarySnapshots,
      runLog: {
        runId: String(payload.runId || runId),
        events: mergeDelegateRunEvents(keptEvents, incomingEvents),
        nextCursor: String(payload.nextCursor || "0"),
        total: Number.parseInt(String(payload.total || "0"), 10) || 0,
        loading: false,
        initialized: true,
        error: "",
      },
    });
  } catch (error) {
    setDelegateState(projectPath, {
      runLog: {
        ...(delegateStateFor(projectPath).runLog || {}),
        runId,
        loading: false,
        initialized: true,
        error: error.message,
      },
    });
  }

  renderAll();
  return delegateStateFor(projectPath).runLog;
}

async function loadDelegateFeed(projectPath, { force = false } = {}) {
  if (!projectPath) {
    return delegateStateFor(projectPath).feed;
  }

  const existing = delegateStateFor(projectPath);
  if (existing.feed?.loading) {
    return existing.feed;
  }
  if (!force && existing.feed?.initialized && !state.delegateFeedPending) {
    return existing.feed;
  }

  state.delegateFeedPending = true;
  setDelegateState(projectPath, {
    feed: {
      ...(existing.feed || {}),
      loading: true,
      error: "",
    },
  });
  renderAll();

  try {
    const payload = await fetchJson(
      `/v1/delegate/feed?project=${encodeURIComponent(projectPath)}&mode=review`,
    );
    setDelegateState(projectPath, {
      feed: {
        cards: Array.isArray(payload.cards)
          ? payload.cards.map(normalizeWatchtowerCard)
          : [],
        events: Array.isArray(payload.events)
          ? payload.events.map(normalizeWatchtowerEvent)
          : [],
        scan: payload.scan || null,
        loading: false,
        initialized: true,
        error: "",
      },
    });
  } catch (error) {
    setDelegateState(projectPath, {
      feed: {
        ...(delegateStateFor(projectPath).feed || {}),
        loading: false,
        initialized: true,
        error: error.message,
      },
    });
  } finally {
    state.delegateFeedPending = false;
  }

  renderAll();
  return delegateStateFor(projectPath).feed;
}

async function loadDelegateProject(projectPath, { force = false } = {}) {
  if (!projectPath) {
    return delegateStateFor(projectPath);
  }

  const existing = delegateStateFor(projectPath);
  if (existing.loading) {
    return existing;
  }
  if (!force && existing.initialized && !delegateStateIsPending(existing)) {
    return existing;
  }

  setDelegateState(projectPath, {
    loading: true,
    error: "",
  });
  renderAll();

  try {
    const payload = await fetchJson(`/v1/delegate?project=${encodeURIComponent(projectPath)}`);
    const previousRunId = selectedDelegateRunId(projectPath);
    const nextStatus = payload.status ? normalizeDelegateStatus(payload.status) : null;
    setDelegateState(projectPath, {
      ...delegatePayloadState(projectPath, payload),
      status: nextStatus,
    });
    updateProjectDelegateStatus(projectPath, nextStatus);
    const nextDelegateState = delegateStateFor(projectPath);
    const nextRunId = selectedDelegateRunId(projectPath, nextDelegateState);
    if (nextRunId) {
      state.delegateSelectedRunIds[projectPath] = nextRunId;
    }
    await loadDelegateRunLog(projectPath, {
      force: true,
      reset: Boolean(nextRunId && nextRunId !== previousRunId),
      runId: nextRunId,
    });
    await loadDelegateFeed(projectPath, { force: true });
  } catch (error) {
    setDelegateState(projectPath, {
      loading: false,
      initialized: true,
      error: error.message,
    });
  }

  renderAll();
  return delegateStateFor(projectPath);
}

async function openDelegateModal(projectPath = state.selectedProject) {
  if (!projectPath) {
    return;
  }

  state.modalThread = null;
  state.projectModalOpen = false;
  state.sessionImportModalProject = "";
  state.summaryModalProject = "";
  state.artifactModalProject = "";
  state.sessionTitleModalProject = "";
  state.sessionTitleModalSessionId = "";
  state.delegateModalProject = projectPath;
  state.delegateBriefPending = false;
  state.delegatePlanPending = false;
  state.delegateRunPending = false;
  state.delegateRunSummaryPending = false;
  state.delegateFeedPending = false;
  state.delegateBriefDirty = false;
  state.delegateBriefDraft = "";
  state.delegateCarouselSlide = "runs";
  renderAll();
  await loadDelegateProject(projectPath);
}

function closeDelegateModal() {
  state.delegateModalProject = "";
  state.delegateBriefDraft = "";
  state.delegateBriefDirty = false;
  state.delegateBriefPending = false;
  state.delegatePlanPending = false;
  state.delegateRunPending = false;
  state.delegateRunSummaryPending = false;
  state.delegateFeedPending = false;
  delegateRunRenderSnapshot = null;
  renderAll();
}

async function selectDelegateRun(runId) {
  const project = currentDelegateProject();
  const selectedRunIdValue = String(runId || "").trim();
  if (!project?.path || !selectedRunIdValue) {
    return;
  }

  const previousRunId = state.delegateSelectedRunIds[project.path] || "";
  state.delegateSelectedRunIds[project.path] = selectedRunIdValue;
  state.delegateCarouselSlide = "log";
  delegateRunRenderSnapshot = null;
  renderAll();

  await loadDelegateRunLog(project.path, {
    force: true,
    reset: previousRunId !== selectedRunIdValue,
    runId: selectedRunIdValue,
  });
}

async function saveDelegateBrief({ quiet = false } = {}) {
  const project = currentDelegateProject();
  if (!project?.path) {
    return null;
  }

  const brief = (state.delegateBriefDirty ? state.delegateBriefDraft : delegateStateFor(project.path).brief || "").trim();
  state.delegateBriefPending = true;
  renderAll();

  try {
    const payload = await fetchJson("/v1/delegate/brief", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        project: project.path,
        brief,
      }),
    });

    setDelegateState(project.path, delegatePayloadState(project.path, payload, { briefFallback: brief }));
    state.delegateBriefDraft = String(payload.brief || brief);
    state.delegateBriefDirty = false;
    renderAll();
    return payload;
  } catch (error) {
    if (!quiet) {
      showError(error);
    }
    throw error;
  } finally {
    state.delegateBriefPending = false;
    renderAll();
  }
}

async function ensureDelegateBriefSaved() {
  if (!state.delegateBriefDirty) {
    return null;
  }
  return saveDelegateBrief({ quiet: false });
}

async function requestDelegatePlan() {
  const project = currentDelegateProject();
  if (!project?.path || state.delegatePlanPending || state.delegateRunPending) {
    return;
  }

  await ensureDelegateBriefSaved();

  state.delegatePlanPending = true;
  const existing = delegateStateFor(project.path);
  setDelegateState(project.path, {
    status: normalizeDelegateStatus({
      ...(existing.status || {}),
      state: "planning",
      projectPath: project.path,
    }),
    error: "",
  });
  renderAll();

  try {
    const payload = await fetchJson("/v1/delegate/plan", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        project: project.path,
      }),
    });

    setDelegateState(project.path, delegatePayloadState(project.path, payload));
  } catch (error) {
    setDelegateState(project.path, {
      error: error.message,
    });
    showError(error);
  } finally {
    state.delegatePlanPending = false;
    renderAll();
  }
}

async function toggleDelegateRun() {
  const project = currentDelegateProject();
  if (!project?.path || state.delegatePlanPending || state.delegateRunPending) {
    return;
  }

  const existing = delegateStateFor(project.path);
  const action =
    existing.status?.state === "running" && !existing.status?.pauseRequested ? "pause" : "start";

  if (action === "start") {
    await ensureDelegateBriefSaved();
  }

  state.delegateRunPending = true;
  state.delegateCarouselSlide = action === "pause" ? "log" : "runs";
  if (action === "pause") {
    setDelegateState(project.path, {
      status: normalizeDelegateStatus({
        ...(existing.status || {}),
        state: existing.status?.state || "running",
        pauseRequested: true,
      }),
    });
  }
  renderAll();

  try {
    const payload = await fetchJson("/v1/delegate/run", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        project: project.path,
        action,
      }),
    });

    setDelegateState(project.path, delegatePayloadState(project.path, payload));
    await loadDelegateRunLog(project.path, {
      force: true,
      reset: action === "start",
    });
    await loadDelegateFeed(project.path, { force: true });
  } catch (error) {
    setDelegateState(project.path, {
      error: error.message,
    });
    showError(error);
  } finally {
    state.delegateRunPending = false;
    renderAll();
  }
}

async function requestDelegateRunSummary() {
  const project = currentDelegateProject();
  if (!project?.path || state.delegateRunSummaryPending) {
    return;
  }

  const delegateState = delegateStateFor(project.path);
  const runId = selectedDelegateRunId(project.path, delegateState);
  if (!runId) {
    return;
  }

  state.delegateRunSummaryPending = true;
  renderAll();

  try {
    const payload = await fetchJson("/v1/delegate/run-summary", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        project: project.path,
        runId,
      }),
    });

    setDelegateState(project.path, {
      latestRunSummarySnapshot: payload.latestRunSummarySnapshot
        ? normalizeDelegateRunSummarySnapshot(payload.latestRunSummarySnapshot)
        : delegateStateFor(project.path).latestRunSummarySnapshot,
      runSummarySnapshots: Array.isArray(payload.runSummarySnapshots)
        ? payload.runSummarySnapshots.map(normalizeDelegateRunSummarySnapshot)
        : delegateStateFor(project.path).runSummarySnapshots,
    });
  } catch (error) {
    setDelegateState(project.path, {
      error: error.message,
    });
    showError(error);
  } finally {
    state.delegateRunSummaryPending = false;
    renderAll();
  }
}

function setProjectModalMode(mode) {
  state.projectModalMode = mode === "new" ? "new" : "existing";
  state.projectModalStatus = "";
  syncProjectRepoSelection("", { preferCurrent: false });
  renderAll();
}

async function openProjectModal() {
  state.summaryModalProject = "";
  state.sessionImportModalProject = "";
  state.artifactModalProject = "";
  state.delegateModalProject = "";
  state.sessionTitleModalProject = "";
  state.sessionTitleModalSessionId = "";
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
  const visualMeta = featuredProjectMeta(projectPath, displayName);
  return {
    projectPath,
    pendingSessionId: pendingSession.sessionId,
    rollbackProject: null,
    optimisticProject: {
      slug: visualMeta.slug,
      displayName: visualMeta.displayName,
      path: projectPath,
      featured: visualMeta.featured,
      featuredAccent: visualMeta.featuredAccent,
      specialRole: visualMeta.specialRole,
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

  if (sessionIsBusy(sessionDetails)) {
    showError(new Error("This session is busy."));
    return;
  }

  const entry = {
    id: makeEntryId(),
    projectPath: project,
    sessionId,
    projectLabel: projectDetails?.displayName || projectDetails?.slug || fallbackProjectLabel(project),
    sessionLabel: sessionOptionLabel(sessionDetails, project),
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
    hydrateHistoryFromThreadEntry(entryById(entry.id) || entry);

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
    void loadProjectArtifacts(project, { force: true, quiet: true }).catch(() => {});
  } catch (error) {
    completeThreadEntry(entry, {
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
  elements.projectDelegateButton.addEventListener("click", () => {
    void openDelegateModal();
  });
  elements.projectAddButton.addEventListener("click", () => {
    void openProjectModal();
  });
  elements.projectArtifactsButton.addEventListener("click", () => {
    void openArtifactsModal();
  });
  elements.artifactShelfOpenButton?.addEventListener("click", () => {
    void openArtifactsModal();
  });
  elements.artifactShelfToggle?.addEventListener("click", () => {
    state.artifactShelfCollapsed = !state.artifactShelfCollapsed;
    persistArtifactShelfCollapsed();
    renderAll();
  });
  elements.sessionImportButton.addEventListener("click", () => {
    void openSessionImportModal();
  });
  elements.sessionRenameButton.addEventListener("click", () => {
    openSessionTitleModal();
  });
  elements.dispatchForm.addEventListener("submit", handleDispatch);
  elements.detailBackdrop.addEventListener("click", closeSessionThread);
  elements.detailClose.addEventListener("click", closeSessionThread);
  elements.sessionImportBackdrop.addEventListener("click", closeSessionImportModal);
  elements.sessionImportClose.addEventListener("click", closeSessionImportModal);
  elements.sessionTitleBackdrop.addEventListener("click", closeSessionTitleModal);
  elements.sessionTitleClose.addEventListener("click", closeSessionTitleModal);
  elements.sessionTitleRemoveButton.addEventListener("click", handleSessionRemove);
  elements.sessionTitleForm.addEventListener("submit", (event) => {
    void handleSessionTitleSubmit(event);
  });
  elements.sessionTitleInput.addEventListener("input", (event) => {
    state.sessionTitleDraft = event.target.value;
    state.sessionTitleConfirmRemove = false;
    state.sessionTitleError = "";
    renderAll();
  });
  elements.summaryBackdrop.addEventListener("click", closeProjectSummary);
  elements.summaryClose.addEventListener("click", closeProjectSummary);
  elements.summaryRefreshButton.addEventListener("click", () => {
    void requestNewProjectSummary();
  });
  elements.artifactsBackdrop.addEventListener("click", closeArtifactsModal);
  elements.artifactsClose.addEventListener("click", closeArtifactsModal);
  elements.artifactsRefreshButton.addEventListener("click", () => {
    const project = currentArtifactsProject();
    if (project?.path) {
      void loadProjectArtifacts(project.path, { force: true });
    }
  });
  elements.delegateBackdrop.addEventListener("click", closeDelegateModal);
  elements.delegateClose.addEventListener("click", closeDelegateModal);
  elements.delegateSaveButton.addEventListener("click", () => {
    void saveDelegateBrief();
  });
  elements.delegatePlanButton?.addEventListener("click", () => {
    void requestDelegatePlan();
  });
  elements.delegateRunButton.addEventListener("click", () => {
    void toggleDelegateRun();
  });
  elements.delegateSummaryButton?.addEventListener("click", () => {
    void requestDelegateRunSummary();
  });
  elements.delegateCarouselPrev?.addEventListener("click", () => {
    advanceDelegateCarousel(-1);
  });
  elements.delegateCarouselNext?.addEventListener("click", () => {
    advanceDelegateCarousel(1);
  });
  elements.delegateCarouselTabs.addEventListener("click", (event) => {
    const button =
      event.target instanceof Element
        ? event.target.closest("[data-delegate-slide]")
        : null;
    if (!button) {
      return;
    }
    setDelegateCarouselSlide(button.dataset.delegateSlide);
    if (button.dataset.delegateSlide === "review") {
      const project = currentDelegateProject();
      if (project?.path) {
        void loadDelegateFeed(project.path, { force: true });
      }
    }
  });
  elements.delegateRunCardList.addEventListener("click", (event) => {
    const button =
      event.target instanceof Element
        ? event.target.closest("[data-delegate-run-id]")
        : null;
    if (!button) {
      return;
    }
    void selectDelegateRun(button.dataset.delegateRunId);
  });
  elements.delegateRunList.addEventListener("click", (event) => {
    const button =
      event.target instanceof Element
        ? event.target.closest("[data-delegate-log-mode]")
        : null;
    if (!button) {
      return;
    }
    const project = currentDelegateProject();
    if (project?.path) {
      setDelegateLogMode(project.path, button.dataset.delegateLogMode);
    }
  });
  elements.delegateBriefInput.addEventListener("input", (event) => {
    state.delegateBriefDraft = event.target.value;
    state.delegateBriefDirty = true;
    renderAll();
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
    void refreshImportableSessions(state.selectedProject, { force: true }).catch(() => {});
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

  const refreshAfterForeground = () => {
    if (document.visibilityState === "hidden") {
      return;
    }
    const now = Date.now();
    if (now - state.lastForegroundRefreshAt < foregroundRefreshDebounceMs) {
      return;
    }
    state.lastForegroundRefreshAt = now;
    void refreshForegroundState();
  };
  window.addEventListener("focus", refreshAfterForeground);
  window.addEventListener("pageshow", refreshAfterForeground);
  document.addEventListener("visibilitychange", refreshAfterForeground);

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && currentModalThread()) {
      closeSessionThread();
      return;
    }
    if (event.key === "Escape" && state.sessionImportModalProject) {
      closeSessionImportModal();
      return;
    }
    if (event.key === "Escape" && state.summaryModalProject) {
      closeProjectSummary();
      return;
    }
    if (event.key === "Escape" && state.artifactModalProject) {
      closeArtifactsModal();
      return;
    }
    if (event.key === "Escape" && state.delegateModalProject) {
      closeDelegateModal();
      return;
    }
    if (event.key === "Escape" && state.sessionTitleModalProject) {
      closeSessionTitleModal();
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
  resetProcessingPhraseCycle();
  restoreThreadEntries();
  hydrateReturnedThreadEntries();
  restoreQueueCollapsed();
  restoreArtifactShelfCollapsed();
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
      await refreshProjectSummaries();
      await refreshDelegates();
      await refreshArtifacts();
    } catch (_error) {
      // Keep the current view on transient failures.
    }
  }, autoRefreshMs);

  window.setInterval(async () => {
    try {
      await refreshProjectSummaries();
      await refreshDelegates();
      await refreshArtifacts();
    } catch (_error) {
      // Keep the current view on transient failures.
    }
  }, 4000);

  window.setInterval(() => {
    if (!processingCopyActive()) {
      return;
    }

    advanceProcessingPhraseCycle();
    renderProcessingCopy();
  }, 3200);
}

boot();
