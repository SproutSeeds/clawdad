import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const repoRoot = path.resolve(import.meta.dirname, "..");
const webAppPath = path.join(repoRoot, "web", "app.js");
const webIndexPath = path.join(repoRoot, "web", "index.html");
const webCssPath = path.join(repoRoot, "web", "app.css");
const nativeMacSourcePath = path.join(repoRoot, "native", "macos", "Sources", "ClawDad", "main.swift");
const nativeMacBuildPath = path.join(repoRoot, "native", "macos", "build-app.sh");
const nativeMacPackagePath = path.join(repoRoot, "native", "macos", "Package.swift");
const nativeMacUpdateControllerPath = path.join(
  repoRoot,
  "native",
  "macos",
  "Sources",
  "ClawDad",
  "ClawDadUpdateController.swift",
);
const iosContentPath = path.join(
  repoRoot,
  "apps",
  "ios",
  "ClawDadMobile",
  "Sources",
  "ClawDadMobile",
  "ContentView.swift",
);
const iosCloudClientPath = path.join(
  repoRoot,
  "apps",
  "ios",
  "ClawDadMobile",
  "Sources",
  "ClawDadMobile",
  "CloudClient.swift",
);
const iosRemoteAssistPath = path.join(
  repoRoot,
  "apps",
  "ios",
  "ClawDadMobile",
  "Sources",
  "ClawDadMobile",
  "RemoteAssist.swift",
);
const nativeMacInputPath = path.join(
  repoRoot,
  "native",
  "macos",
  "Sources",
  "ClawDad",
  "MacInputController.swift",
);
const nativeMacShortcutPath = path.join(
  repoRoot,
  "native",
  "macos",
  "Sources",
  "ClawDad",
  "MacRemoteShortcut.swift",
);
const nativeMacTerminalTabsPath = path.join(
  repoRoot,
  "native",
  "macos",
  "Sources",
  "ClawDad",
  "MacTerminalTabs.swift",
);
const nativeMacRemotePeerPath = path.join(
  repoRoot,
  "native",
  "macos",
  "Sources",
  "ClawDad",
  "MacRemotePeer.swift",
);
const nativeMacRemoteAssistHostPath = path.join(
  repoRoot,
  "native",
  "macos",
  "Sources",
  "ClawDad",
  "RemoteAssistHost.swift",
);
const nativeMacKeyboardLayoutPath = path.join(
  repoRoot,
  "native",
  "macos",
  "Sources",
  "ClawDad",
  "MacKeyboardLayout.swift",
);
const remoteSessionStateProtocolPath = path.join(
  repoRoot,
  "native",
  "ClawDadRemoteAssistProtocol",
  "Sources",
  "ClawDadRemoteAssistProtocol",
  "RemoteSessionStateProtocol.swift",
);
const remoteInputProtocolPath = path.join(
  repoRoot,
  "native",
  "ClawDadRemoteAssistProtocol",
  "Sources",
  "ClawDadRemoteAssistProtocol",
  "RemoteInputProtocol.swift",
);
const remoteTerminalTabProtocolPath = path.join(
  repoRoot,
  "native",
  "ClawDadRemoteAssistProtocol",
  "Sources",
  "ClawDadRemoteAssistProtocol",
  "RemoteTerminalTabProtocol.swift",
);
const iosInfoPlistPath = path.join(repoRoot, "apps", "ios", "ClawDadMobile", "Resources", "Info.plist");
const iosMascotContentsPath = path.join(
  repoRoot,
  "apps",
  "ios",
  "ClawDadMobile",
  "Resources",
  "Assets.xcassets",
  "ClawDadMascot.imageset",
  "Contents.json",
);
const iosMascotImagePath = path.join(
  repoRoot,
  "apps",
  "ios",
  "ClawDadMobile",
  "Resources",
  "Assets.xcassets",
  "ClawDadMascot.imageset",
  "clawdad-mascot.png",
);

async function loadComposerCutHelper() {
  const source = await readFile(webAppPath, "utf8");
  const start = source.indexOf("async function cutComposerDraft(");
  const end = source.indexOf("async function fetchJson", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  assert.ok(end > start);

  const context = {};
  vm.createContext(context);
  vm.runInContext(
    `${source.slice(start, end)}\nglobalThis.cutComposerDraft = cutComposerDraft;`,
    context,
  );
  return context.cutComposerDraft;
}

async function loadHistoryMergeHelpers() {
  const source = await readFile(webAppPath, "utf8");
  const start = source.indexOf("function normalizeHistoryAttachments");
  const end = source.indexOf("function threadEntryFromHistoryItem");
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  assert.ok(end > start);

  const context = {
    Date,
  };
  vm.createContext(context);
  vm.runInContext(
    `
const historyDuplicateWindowMs = 2 * 60 * 1000;
const threadEntryCacheLimit = 80;
function makeEntryId() { return "generated-id"; }
function fallbackProjectLabel(projectPath) { return String(projectPath || "project").split("/").filter(Boolean).pop() || "project"; }
function sessionForEntry() { return null; }
function providerLabel(provider) { return String(provider || "session"); }
function sessionFingerprint(sessionId) { return String(sessionId || "").slice(-4); }
${source.slice(start, end)}
globalThis.mergeHistoryItems = mergeHistoryItems;
globalThis.normalizeHistoryItem = normalizeHistoryItem;
globalThis.historyEntryQueuedForLater = historyEntryQueuedForLater;
`,
    context,
  );
  return context;
}

async function loadThreadCacheHelpers() {
  const source = await readFile(webAppPath, "utf8");
  const start = source.indexOf("function normalizeHistoryAttachments");
  const end = source.indexOf("function decorateCopyButton");
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  assert.ok(end > start);

  const store = new Map();
  const context = {
    Date,
    state: { threadEntries: [], historyThreads: {} },
    threadCacheKey: "clawdad-thread-log-test",
    localStorage: {
      get length() {
        return store.size;
      },
      getItem(key) {
        return store.has(key) ? store.get(key) : null;
      },
      setItem(key, value) {
        store.set(key, String(value));
      },
      removeItem(key) {
        store.delete(key);
      },
      key(index) {
        return [...store.keys()][index] || null;
      },
    },
  };
  vm.createContext(context);
  vm.runInContext(
    `
const historyDuplicateWindowMs = 2 * 60 * 1000;
const threadEntryCacheLimit = 80;
const queuedDispatchGraceMs = 15000;
const queuedDispatchAttachGraceMs = 2 * 60 * 1000;
const staleLocalPendingBlockMs = queuedDispatchAttachGraceMs;
function makeEntryId() { return "generated-id"; }
function fallbackProjectLabel(projectPath) { return String(projectPath || "project").split("/").filter(Boolean).pop() || "project"; }
function sessionForEntry() { return null; }
function providerLabel(provider) { return String(provider || "session"); }
function sessionFingerprint(sessionId) { return String(sessionId || "").slice(-4); }
function entrySessionLabel(entry) { return entry?.sessionLabel || "codex • test"; }
function historyKey(projectPath, sessionId) { return String(projectPath || "") + "::" + String(sessionId || ""); }
function historyStateFor(projectPath, sessionId) {
  return state.historyThreads[historyKey(projectPath, sessionId)] || {
    items: [],
    nextCursor: "0",
    loading: false,
    initialized: false,
    prefetchedAt: 0,
    error: "",
  };
}
function setHistoryState(projectPath, sessionId, nextState) {
  const key = historyKey(projectPath, sessionId);
  state.historyThreads[key] = {
    ...historyStateFor(projectPath, sessionId),
    ...nextState,
  };
}
${source.slice(start, end)}
globalThis.persistThreadEntries = persistThreadEntries;
globalThis.restoreThreadEntries = restoreThreadEntries;
globalThis.purgeLegacyThreadEntryCaches = purgeLegacyThreadEntryCaches;
globalThis.hydrateThreadEntriesFromHistoryItems = hydrateThreadEntriesFromHistoryItems;
globalThis.threadEntryVisibleInQueue = threadEntryVisibleInQueue;
globalThis.queueEntries = queueEntries;
globalThis.entryCopyKey = entryCopyKey;
globalThis.historyEntryQueuedForLater = historyEntryQueuedForLater;
`,
    context,
  );
  return context;
}

async function loadProjectSortHelpers() {
  const source = await readFile(webAppPath, "utf8");
  const start = source.indexOf("function timestampToMs");
  const end = source.indexOf("function hydrateProjectVisuals", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  assert.ok(end > start);

  const context = {
    Date,
    state: { threadEntries: [] },
  };
  vm.createContext(context);
  vm.runInContext(
    `
function projectHasLiveDelegate() { return false; }
${source.slice(start, end)}
globalThis.compareProjects = compareProjects;
globalThis.projectActivityTimestampMs = projectActivityTimestampMs;
`,
    context,
  );
  return context;
}

test("web history merge clears stale cached synthetic answered transcript cards", async () => {
  const { mergeHistoryItems } = await loadHistoryMergeHelpers();
  const staleCached = {
    requestId: "codex:019ddf17-7e93-7840-a89b-cc2702c32a02:54",
    projectPath: "/repo/clawdad",
    sessionId: "019ddf17-7e93-7840-a89b-cc2702c32a02",
    provider: "codex",
    message: "Please compare OpenClaw and Clawdad.",
    sentAt: "2026-05-03T15:35:13.537Z",
    answeredAt: "2026-05-03T15:35:16.000Z",
    status: "answered",
    exitCode: 0,
    response: "I will verify public docs first.",
  };
  const authoritativeServerItem = {
    ...staleCached,
    answeredAt: null,
    status: "queued",
    exitCode: null,
    response: "",
  };

  const merged = mergeHistoryItems([staleCached], [authoritativeServerItem]);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].requestId, authoritativeServerItem.requestId);
  assert.equal(merged[0].status, "queued");
  assert.equal(merged[0].response, "");
  assert.equal(merged[0].answeredAt, null);
  assert.equal(merged[0].exitCode, null);
});

test("web history merge keeps one working Direct turn and separates a true Queue item", async () => {
  const { mergeHistoryItems, historyEntryQueuedForLater } = await loadHistoryMergeHelpers();
  const directRequest = {
    requestId: "1477ec45-ae50-4ad4-a7f6-34096043bec7",
    projectPath: "/repo/go-to-market",
    sessionId: "019f9cd2-7a08-7653-bb33-a004f5135c2e",
    provider: "codex",
    message: "What did we most recently work on?",
    sentAt: "2026-07-26T05:07:42.000Z",
    answeredAt: null,
    status: "working",
    response: "",
    scheduleMode: "direct",
    deliveryMechanism: "dispatch_worker",
  };
  const providerCopy = {
    ...directRequest,
    requestId: "codex:019f9cd2-7a08-7653-bb33-a004f5135c2e:20260726T050742000Z",
    sentAt: "2026-07-26T05:07:42.040Z",
    scheduleMode: "",
    deliveryMechanism: "",
  };
  const queuedRequest = {
    requestId: "9be10cb6-fcd8-46c3-9052-6cd4ee680c9b",
    projectPath: directRequest.projectPath,
    sessionId: directRequest.sessionId,
    provider: "codex",
    message: "Also, what should we do next?",
    sentAt: "2026-07-26T05:07:56.000Z",
    answeredAt: null,
    status: "queued",
    response: "",
    scheduleMode: "queue",
    deliveryMechanism: "queued_worker",
  };

  const merged = mergeHistoryItems([directRequest], [providerCopy, queuedRequest]);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].requestId, directRequest.requestId);
  assert.equal(merged[0].status, "working");
  assert.equal(merged[0].scheduleMode, "direct");
  assert.equal(historyEntryQueuedForLater(merged[0], merged), false);
  assert.equal(merged[1].requestId, queuedRequest.requestId);
  assert.equal(merged[1].status, "queued");
  assert.equal(historyEntryQueuedForLater(merged[1], merged), true);
});

test("web history merge preserves prepared message and response audio metadata", async () => {
  const { mergeHistoryItems } = await loadHistoryMergeHelpers();
  const base = {
    requestId: "request-audio",
    projectPath: "/repo/clawdad",
    sessionId: "session-audio",
    provider: "codex",
    message: "Say it.",
    sentAt: "2026-05-06T12:00:00.000Z",
    answeredAt: "2026-05-06T12:00:05.000Z",
    status: "answered",
    exitCode: 0,
    response: "Playable response.",
  };
  const messageAudio = {
    message: {
      audioId: "audio-message-ready",
      state: "ready",
      provider: "doc-reader",
      voiceId: "af_heart",
      modelId: "kokoro",
      outputFormat: "wav",
      parts: [{ index: 1, fileName: "doc-reader.wav", url: "/v1/tts/audio?docReaderItemId=message-ready" }],
    },
  };
  const responseAudio = {
    response: {
      audioId: "audio-ready",
      state: "ready",
      provider: "openai",
      voiceId: "cedar",
      modelId: "gpt-4o-mini-tts",
      outputFormat: "mp3",
      parts: [{ index: 1, fileName: "part-001.mp3", url: "/v1/tts/audio?audioId=audio-ready" }],
    },
  };

  const merged = mergeHistoryItems([{ ...base, audio: messageAudio }], [{ ...base, audio: responseAudio }]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].audio.message.state, "ready");
  assert.equal(merged[0].audio.message.parts[0].url, "/v1/tts/audio?docReaderItemId=message-ready");
  assert.equal(merged[0].audio.response.state, "ready");
  assert.equal(merged[0].audio.response.parts[0].url, "/v1/tts/audio?audioId=audio-ready");

  const preserved = mergeHistoryItems(merged, [{ ...base, response: "Playable response." }]);
  assert.equal(preserved[0].audio.message.audioId, "audio-message-ready");
  assert.equal(preserved[0].audio.response.audioId, "audio-ready");
});

test("web composer exposes voice transcription controls", async () => {
  const [indexHtml, appSource] = await Promise.all([
    readFile(webIndexPath, "utf8"),
    readFile(webAppPath, "utf8"),
  ]);

  assert.match(indexHtml, /id="composerVoiceButton"/u);
  assert.match(indexHtml, /id="composerVoiceCaptureInput"/u);
  assert.match(indexHtml, /id="settingsVoiceInputSelect"/u);
  assert.match(indexHtml, /id="settingsRefreshVoiceDevicesButton"/u);
  const actionsStart = indexHtml.indexOf('class="composer-actions"');
  const sendStart = indexHtml.indexOf('id="dispatchButton"', actionsStart);
  const voiceStart = indexHtml.indexOf('id="composerVoiceButton"', actionsStart);
  const toolsMenuStart = indexHtml.indexOf('id="composerToolsMenu"', actionsStart);
  const toolsMenuEnd = indexHtml.indexOf('id="quickPromptModal"', toolsMenuStart);
  assert.ok(sendStart > actionsStart);
  assert.ok(voiceStart > sendStart);
  assert.doesNotMatch(indexHtml.slice(toolsMenuStart, toolsMenuEnd), /id="composerVoiceButton"/u);
  assert.match(appSource, /navigator\.mediaDevices\.getUserMedia/u);
  assert.match(appSource, /navigator\.mediaDevices\.enumerateDevices/u);
  assert.match(appSource, /const voiceInputDeviceKey = "clawdad-voice-input-device-v1"/u);
  assert.match(appSource, /function refreshVoiceInputDevices/u);
  assert.match(appSource, /function getVoiceRecordingStream/u);
  assert.match(appSource, /deviceId: \{ exact: deviceId \}/u);
  assert.match(appSource, /new MediaRecorder/u);
  assert.match(appSource, /\/v1\/stt\/transcribe/u);
  assert.match(appSource, /insertTranscriptIntoComposer/u);
});

test("macOS native wrapper grants microphone capture for composer dictation", async () => {
  const [nativeSource, buildScript] = await Promise.all([
    readFile(nativeMacSourcePath, "utf8"),
    readFile(nativeMacBuildPath, "utf8"),
  ]);

  assert.match(nativeSource, /WKUIDelegate/u);
  assert.match(nativeSource, /webView\.uiDelegate = self/u);
  assert.match(nativeSource, /requestMediaCapturePermissionFor origin: WKSecurityOrigin/u);
  assert.match(nativeSource, /type == \.microphone \|\| type == \.cameraAndMicrophone/u);
  assert.match(nativeSource, /decisionHandler\(\.grant\)/u);
  assert.match(buildScript, /NSMicrophoneUsageDescription/u);
  assert.match(buildScript, /record voice messages and transcribe them into the composer/u);
});

test("macOS packaged shell carries a self-contained ClawDad runtime", async () => {
  const [nativeSource, buildScript] = await Promise.all([
    readFile(nativeMacSourcePath, "utf8"),
    readFile(nativeMacBuildPath, "utf8"),
  ]);

  assert.match(
    nativeSource,
    /resources\.appendingPathComponent\("runtime", isDirectory: true\)/u,
  );
  assert.match(nativeSource, /\/v1\/native\/capabilities/u);
  assert.match(nativeSource, /json\["remoteAssist"\] as\? Bool/u);
  assert.match(nativeSource, /json\["nativeRuntimeVersion"\] as\? String/u);
  assert.match(nativeSource, /\/bin\/launchctl/u);
  assert.match(nativeSource, /waitForManagedServiceRemoval/u);
  assert.match(nativeSource, /consecutiveAbsentChecks >= 2/u);
  assert.match(nativeSource, /process\.arguments = \["list", label\]/u);
  assert.match(nativeSource, /CLAWDAD_NATIVE_RUNTIME_VERSION/u);
  assert.match(nativeSource, /prepareBundledRuntime/u);
  assert.match(nativeSource, /\.runtime-\\\(UUID\(\)\.uuidString\.lowercased\(\)\)/u);
  assert.match(nativeSource, /runtimeRootIsValid/u);
  assert.match(buildScript, /Contents\/Resources\/runtime/u);
  assert.match(buildScript, /runtime_dir\/\.bundle-version/u);
  assert.match(buildScript, /ditto "\$repo_root\/lib" "\$runtime_dir\/lib"/u);
  assert.match(buildScript, /ditto "\$repo_root\/web" "\$runtime_dir\/web"/u);
  assert.match(
    buildScript,
    /ditto "\$repo_root\/node_modules" "\$runtime_dir\/node_modules"/u,
  );
});

test("macOS desktop app exposes signed updates and privacy-safe diagnostics", async () => {
  const [indexHtml, appSource, nativeSource, updateSource, buildScript, packageSource] =
    await Promise.all([
      readFile(webIndexPath, "utf8"),
      readFile(webAppPath, "utf8"),
      readFile(nativeMacSourcePath, "utf8"),
      readFile(nativeMacUpdateControllerPath, "utf8"),
      readFile(nativeMacBuildPath, "utf8"),
      readFile(nativeMacPackagePath, "utf8"),
    ]);

  assert.match(
    packageSource,
    /\.package\([\s\S]*url: "https:\/\/github\.com\/sparkle-project\/Sparkle"/u,
  );
  assert.match(packageSource, /exact: "2\.9\.2"/u);
  assert.match(updateSource, /SPUStandardUpdaterController/u);
  assert.match(updateSource, /controller\.checkForUpdates\(sender\)/u);
  assert.match(buildScript, /SUFeedURL/u);
  assert.match(buildScript, /SUPublicEDKey/u);
  assert.match(buildScript, /Sparkle\.framework\/Versions\/B\/XPCServices\/Installer\.xpc/u);
  assert.match(nativeSource, /case "getDesktopAppStatus":/u);
  assert.match(nativeSource, /case "checkForUpdates":/u);
  assert.match(nativeSource, /case "openLogs":/u);
  assert.match(nativeSource, /case "copyDiagnostics":/u);
  assert.match(nativeSource, /ClawDad Desktop Diagnostics/u);
  assert.match(indexHtml, /id="settingsDesktopAppSection"/u);
  assert.match(indexHtml, /id="settingsCheckUpdatesButton"/u);
  assert.match(indexHtml, /id="settingsOpenLogsButton"/u);
  assert.match(indexHtml, /id="settingsCopyDiagnosticsButton"/u);
  assert.match(appSource, /function renderDesktopAppSettings/u);
  assert.match(appSource, /nativeBridge\.checkForUpdates\(\)/u);
  assert.match(appSource, /Privacy-safe diagnostics copied\./u);
});

test("Remote Assist settings explain both macOS permission steps", async () => {
  const [indexHtml, appSource, cssSource] = await Promise.all([
    readFile(webIndexPath, "utf8"),
    readFile(webAppPath, "utf8"),
    readFile(webCssPath, "utf8"),
  ]);

  assert.match(
    indexHtml,
    /id="settingsRemoteAssistInfoButton"[\s\S]*aria-controls="settingsRemoteAssistInfo"[\s\S]*title="How to enable Remote Assist permissions"/u,
  );
  const infoButtonStart = indexHtml.indexOf('id="settingsRemoteAssistInfoButton"');
  const infoButtonEnd = indexHtml.indexOf("</button>", infoButtonStart);
  assert.doesNotMatch(indexHtml.slice(infoButtonStart, infoButtonEnd), /<svg/u);
  assert.match(indexHtml, /Privacy &amp; Security &gt; Screen &amp; System Audio Recording/u);
  assert.match(indexHtml, /Privacy &amp; Security &gt; Accessibility/u);
  assert.match(indexHtml, /Allow assistive applications to control the[\s\S]*computer/u);
  assert.match(indexHtml, /both permission[\s\S]*buttons say Allowed/u);
  assert.match(indexHtml, /Persistent Content Capture approval/u);
  assert.match(appSource, /remoteAssistInfoOpen: false/u);
  assert.match(appSource, /setRemoteAssistInfoOpen\(false, \{ restoreFocus: true \}\)/u);
  assert.match(cssSource, /\.settings-inline-info-button[\s\S]*background: transparent !important[\s\S]*cursor: pointer/u);
  assert.match(cssSource, /\.settings-inline-info-button:hover[\s\S]*text-decoration: underline/u);
  assert.match(cssSource, /\.settings-permission-help\[hidden\][\s\S]*display: none/u);
});

test("Remote Assist releases stale sessions across network changes", async () => {
  const [remoteAssistSource, hostSource] = await Promise.all([
    readFile(iosRemoteAssistPath, "utf8"),
    readFile(nativeMacRemoteAssistHostPath, "utf8"),
  ]);

  assert.match(remoteAssistSource, /failAndRelease\(/u);
  assert.match(remoteAssistSource, /case \.disconnected:[\s\S]*schedulePeerRecoveryTimeout/u);
  assert.match(remoteAssistSource, /"reason": \.string\("phone_connection_ended"\)/u);
  assert.match(hostSource, /case \.replaceCurrent:[\s\S]*stopActiveSession/u);
  assert.match(hostSource, /case \.disconnected:[\s\S]*schedulePeerDisconnectTimeout/u);
  assert.match(hostSource, /incomingDeviceId: envelope\.sourceDeviceId/u);
});

test("web composer exposes accessible Copy and Cut controls for the current prompt draft", async () => {
  const [indexHtml, appSource, cssSource] = await Promise.all([
    readFile(webIndexPath, "utf8"),
    readFile(webAppPath, "utf8"),
    readFile(webCssPath, "utf8"),
  ]);

  assert.match(
    indexHtml,
    /class="message-input-wrap"[\s\S]*id="messageInput"[\s\S]*id="messageCutButton"[\s\S]*id="messageCopyButton"/u,
  );
  assert.match(indexHtml, /id="messageCutButton"[\s\S]*aria-label="Cut draft"[\s\S]*title="Cut draft"/u);
  assert.match(indexHtml, /id="composerClipboardStatus"[\s\S]*role="status"[\s\S]*aria-live="polite"/u);
  assert.match(indexHtml, /Copies the entire draft to the clipboard, then clears the editor\./u);
  assert.match(appSource, /messageCutButton: document\.querySelector\("#messageCutButton"\)/u);
  assert.match(appSource, /messageCopyButton: document\.querySelector\("#messageCopyButton"\)/u);
  assert.match(appSource, /composerClipboardStatus: document\.querySelector\("#composerClipboardStatus"\)/u);
  assert.match(appSource, /const composerCopyKey = "composer-message";/u);
  assert.match(appSource, /const composerCutKey = "composer-cut";/u);
  assert.match(appSource, /copyText\(text\);[\s\S]*markCopied\(composerCopyKey\)/u);
  assert.match(appSource, /state\.composerCutPending[\s\S]*didCut = await cutComposerDraft\(input\)/u);
  assert.match(appSource, /input\.focus\(\{ preventScroll: true \}\)/u);
  assert.match(appSource, /updateMessageCopyButton\(\);/u);
  assert.match(appSource, /updateMessageCutButton\(\);/u);
  assert.match(cssSource, /\.message-input-wrap/u);
  assert.match(cssSource, /\.composer-clipboard-controls/u);
  assert.match(cssSource, /\.composer-copy-button/u);
  assert.match(cssSource, /\.composer-cut-button/u);

  const cutHandlerStart = appSource.indexOf(
    'elements.messageCutButton?.addEventListener("click"',
  );
  const copyHandlerStart = appSource.indexOf(
    'elements.messageCopyButton?.addEventListener("click"',
    cutHandlerStart,
  );
  assert.notEqual(cutHandlerStart, -1);
  assert.notEqual(copyHandlerStart, -1);
  const cutHandler = appSource.slice(cutHandlerStart, copyHandlerStart);
  assert.doesNotMatch(cutHandler, /composerAttachments|clearComposerAttachments/u);
});

test("web Cut copies the exact draft and preserves it when clipboard writing fails", async () => {
  const cutComposerDraft = await loadComposerCutHelper();
  const rawDraft = "  First line\nSecond line  ";
  const input = { value: rawDraft };
  let clipboardText = "";

  assert.equal(
    await cutComposerDraft(input, async (text) => {
      clipboardText = text;
    }),
    true,
  );
  assert.equal(clipboardText, rawDraft);
  assert.equal(input.value, "");

  const failedInput = { value: rawDraft };
  await assert.rejects(
    cutComposerDraft(failedInput, async () => {
      throw new Error("Clipboard unavailable");
    }),
    /Clipboard unavailable/u,
  );
  assert.equal(failedInput.value, rawDraft);

  const blankInput = { value: " \n " };
  let blankWriteAttempted = false;
  assert.equal(
    await cutComposerDraft(blankInput, async () => {
      blankWriteAttempted = true;
    }),
    false,
  );
  assert.equal(blankWriteAttempted, false);
  assert.equal(blankInput.value, " \n ");
});

test("iPhone composer copies and cuts drafts, then records voice notes through paired ClawDad STT", async () => {
  const [contentSource, cloudSource, infoPlist] = await Promise.all([
    readFile(iosContentPath, "utf8"),
    readFile(iosCloudClientPath, "utf8"),
    readFile(iosInfoPlistPath, "utf8"),
  ]);
  const composerSource = contentSource.slice(
    contentSource.indexOf("private var composerPanel"),
    contentSource.indexOf("private var threadPreviewPanel"),
  );

  assert.match(contentSource, /composerCopied \? "checkmark" : "doc\.on\.doc"/u);
  assert.match(contentSource, /copyTextToPasteboard\(message\)/u);
  assert.match(contentSource, /composerCutConfirmed \? "checkmark" : "scissors"/u);
  assert.match(contentSource, /accessibilityIdentifier\("clawdad\.composer\.cut"\)/u);
  assert.match(
    contentSource,
    /func performComposerDraftCut\([\s\S]*copyToClipboard\(draft\)[\s\S]*draft = ""/u,
  );
  assert.match(
    contentSource,
    /private func cutComposerDraft\(\)[\s\S]*voiceDraftBase = ""[\s\S]*messageEditorFocused = true/u,
  );
  assert.match(contentSource, /AVAudioRecorder/u);
  assert.match(contentSource, /AVAudioApplication\.requestRecordPermission/u);
  assert.match(contentSource, /\.record,\s*mode: \.default/u);
  assert.doesNotMatch(contentSource, /mode: \.spokenAudio/u);
  assert.match(contentSource, /voiceRecorder\.state == \.recording \? "stop\.fill" : "mic\.fill"/u);
  assert.match(contentSource, /session\.transcribeVoice\(/u);
  assert.match(contentSource, /voiceDraftBase = message\.trimmingCharacters/u);
  assert.match(contentSource, /let draft = currentDraft\.isEmpty \? voiceDraftBase : currentDraft/u);
  assert.match(contentSource, /message = draft \+ "\\n\\n" \+ transcript/u);
  assert.doesNotMatch(composerSource, /Text\(dispatchMode\.label\)/u);
  assert.doesNotMatch(composerSource, /Text\(accessMode\.label\)/u);
  assert.doesNotMatch(composerSource, /Text\(destinationSummary\)/u);
  assert.match(cloudSource, /type: "speech\.transcribe\.request"/u);
  assert.match(cloudSource, /case "speech\.transcribe\.accepted":/u);
  assert.match(cloudSource, /case "speech\.transcription":/u);
  assert.match(cloudSource, /voiceTranscriptionTimeoutTask/u);
  assert.match(cloudSource, /The transcript did not return\./u);
  assert.match(cloudSource, /The connection dropped before your transcript returned\./u);
  assert.match(infoPlist, /<key>NSMicrophoneUsageDescription<\/key>/u);
});

test("iPhone thread cards read both sent messages and Codex responses aloud on demand", async () => {
  const [contentSource, cloudSource, infoPlist] = await Promise.all([
    readFile(iosContentPath, "utf8"),
    readFile(iosCloudClientPath, "utf8"),
    readFile(iosInfoPlistPath, "utf8"),
  ]);

  assert.match(contentSource, /struct MessageReadAloudButton: View/u);
  assert.match(contentSource, /Image\(systemName: "speaker\.wave\.2\.fill"\)/u);
  assert.match(contentSource, /kind: \.message/u);
  assert.match(contentSource, /kind: \.response/u);
  assert.ok(contentSource.includes('return "Read \\(accessibilitySubject) aloud"'));
  assert.match(contentSource, /MessageReadAloudButton\([\s\S]*MessageCopyButton\(/u);
  assert.match(cloudSource, /type: "speech\.synthesize\.request"/u);
  assert.match(cloudSource, /"executionPreference": \.string\("paired-mac-first"\)/u);
  assert.match(cloudSource, /"allowRemoteFallback": \.bool\(allowUmbraReadAloudFallback\)/u);
  assert.match(cloudSource, /case "speech\.synthesis\.chunk":/u);
  assert.match(cloudSource, /case "speech\.synthesis\.complete":/u);
  assert.match(cloudSource, /\.playback,\s*mode: \.spokenAudio\s*\)/u);
  const playbackSessionSource = cloudSource.slice(
    cloudSource.indexOf("private func activatePlaybackSession()"),
    cloudSource.indexOf("private func playCurrentPart()"),
  );
  assert.doesNotMatch(playbackSessionSource, /allowAirPlay|allowBluetoothA2DP/u);
  assert.match(infoPlist, /<key>UIBackgroundModes<\/key>[\s\S]*<string>audio<\/string>/u);
  assert.match(contentSource, /Text\("Speech is generated on your paired Mac first\."\)/u);
  assert.match(contentSource, /Toggle\(isOn: \$session\.allowUmbraReadAloudFallback\)/u);
});

test("iPhone creates project directories through the paired Mac default root", async () => {
  const [contentSource, cloudSource] = await Promise.all([
    readFile(iosContentPath, "utf8"),
    readFile(iosCloudClientPath, "utf8"),
  ]);

  assert.match(contentSource, /struct NewProjectDirectorySheet: View/u);
  assert.match(contentSource, /accessibilityLabel\("Create project directory"\)/u);
  assert.match(contentSource, /TextField\("Project directory name", text: \$projectName\)/u);
  assert.match(contentSource, /session\.createProjectDirectory\(name: normalizedName\)/u);
  assert.match(contentSource, /\.interactiveDismissDisabled\(session\.projectCreatePending\)/u);
  assert.match(cloudSource, /func createProjectDirectory\(name: String\)/u);
  assert.match(cloudSource, /type: "project\.create\.request"/u);
  assert.match(cloudSource, /case "project\.created":/u);
  assert.doesNotMatch(
    cloudSource.slice(
      cloudSource.indexOf("func createProjectDirectory(name: String)"),
      cloudSource.indexOf("func clearProjectCreateFeedback", cloudSource.indexOf("func createProjectDirectory(name: String)")),
    ),
    /"root"|"path"/u,
  );
});

test("iPhone connection recovery names the paired Mac and avoids an indefinite Remote Assist spinner", async () => {
  const [contentSource, cloudSource, remoteAssistSource] = await Promise.all([
    readFile(iosContentPath, "utf8"),
    readFile(iosCloudClientPath, "utf8"),
    readFile(iosRemoteAssistPath, "utf8"),
  ]);

  assert.match(
    cloudSource,
    /Secure connection interrupted\. Reconnecting to your paired Mac automatically/u,
  );
  assert.match(contentSource, /Relay connected, Mac reconnecting/u);
  assert.match(contentSource, /Connection interrupted\. Reconnecting to your Mac/u);
  assert.match(remoteAssistSource, /guard cloudSession\.connected else/u);
  assert.match(remoteAssistSource, /guard cloudSession\.hostOnline else/u);
  assert.match(remoteAssistSource, /did not answer within 25 seconds/u);
});

test("iPhone Remote Assist supports full-screen landscape rotation", async () => {
  const [remoteAssistSource, infoPlist] = await Promise.all([
    readFile(iosRemoteAssistPath, "utf8"),
    readFile(iosInfoPlistPath, "utf8"),
  ]);

  assert.match(infoPlist, /UIInterfaceOrientationPortrait/u);
  assert.match(infoPlist, /UIInterfaceOrientationLandscapeLeft/u);
  assert.match(infoPlist, /UIInterfaceOrientationLandscapeRight/u);
  assert.match(remoteAssistSource, /Color\.black\.ignoresSafeArea\(\)/u);
  assert.match(remoteAssistSource, /\.statusBarHidden\(true\)/u);
  assert.match(remoteAssistSource, /\.persistentSystemOverlays\(\.hidden\)/u);
  assert.match(remoteAssistSource, /videoView\.videoContentMode = \.scaleAspectFit/u);
});

test("iPhone Remote Assist keeps one keyboard-safe launcher in the corner and nests approved shortcuts", async () => {
  const [remoteAssistSource, shortcutSource, inputProtocolSource] = await Promise.all([
    readFile(iosRemoteAssistPath, "utf8"),
    readFile(nativeMacShortcutPath, "utf8"),
    readFile(remoteInputProtocolPath, "utf8"),
  ]);

  assert.match(remoteAssistSource, /@State private var controlsExpanded = false/u);
  assert.match(remoteAssistSource, /@State private var controlPage: RemoteAssistControlPage = \.primary/u);
  assert.match(
    remoteAssistSource,
    /Image\(systemName: controlsExpanded \? "chevron\.down" : "ellipsis"\)/u,
  );
  assert.match(remoteAssistSource, /\.frame\(width: 44, height: 44\)/u);
  assert.match(remoteAssistSource, /RemoteAssistLauncherButtonStyle/u);
  assert.match(remoteAssistSource, /\.frame\(width: 36, height: 36\)/u);
  assert.match(remoteAssistSource, /mainControlPanelWidth: CGFloat = 148/u);
  assert.match(remoteAssistSource, /shortcutControlPanelWidth: CGFloat = 196/u);
  assert.match(
    remoteAssistSource,
    /\.frame\(width: controlPanelWidth, alignment: \.trailing\)\s*\.padding\(10\)/u,
  );
  assert.match(
    remoteAssistSource,
    /private var controlPanelWidth: CGFloat \{[\s\S]*case \.primary:[\s\S]*Self\.mainControlPanelWidth[\s\S]*case \.shortcuts:[\s\S]*Self\.shortcutControlPanelWidth/u,
  );
  assert.match(
    remoteAssistSource,
    /alignment: \.bottomTrailing[\s\S]*\.padding\(\.trailing, 4\)[\s\S]*\.padding\(\.bottom, 4\)[\s\S]*\.ignoresSafeArea\(\.container, edges: \.all\)/u,
  );
  assert.match(
    remoteAssistSource,
    /if controlsExpanded \{\s*collapseControls\(\)\s*\} else \{\s*controller\.dismissKeyboard\(\)\s*controlPage = \.primary\s*controlsExpanded = true/u,
  );
  assert.match(remoteAssistSource, /"Open Remote Assist controls"/u);
  assert.match(remoteAssistSource, /Image\(systemName: "keyboard\.badge\.ellipsis"\)/u);
  assert.match(remoteAssistSource, /controlPage = \.shortcuts/u);
  assert.match(remoteAssistSource, /Text\("Special Commands"\)/u);
  assert.match(remoteAssistSource, /accessibilityLabel\("Back to Remote Assist controls"\)/u);
  assert.match(
    remoteAssistSource,
    /ForEach\(RemoteShortcut\.allCases[\s\S]*collapseControls\(\)[\s\S]*controller\.sendShortcut\(shortcut\)/u,
  );
  assert.match(remoteAssistSource, /func collapseControls\(\) \{\s*controlsExpanded = false\s*controlPage = \.primary/u);
  assert.match(inputProtocolSource, /case controlC = "control_c"/u);
  assert.match(inputProtocolSource, /case controlJ = "control_j"/u);
  assert.match(inputProtocolSource, /case controlL = "control_l"/u);
  assert.match(inputProtocolSource, /case commandT = "command_t"/u);
  assert.match(inputProtocolSource, /case commandTab = "command_tab"/u);
  assert.match(remoteAssistSource, /case \.commandT: "⌘T"/u);
  assert.match(
    remoteAssistSource,
    /case \.commandT: "Command T, open a new tab in the active Mac app"/u,
  );
  assert.match(
    shortcutSource,
    /case \.commandT:[\s\S]*kVK_ANSI_T[\s\S]*flags: \.maskCommand[\s\S]*delivery: \.system/u,
  );
  assert.match(shortcutSource, /case \.commandTab:[\s\S]*flags: \.maskCommand[\s\S]*delivery: \.system/u);
  assert.match(shortcutSource, /case \.controlC:[\s\S]*flags: \.maskControl/u);
  assert.doesNotMatch(
    remoteAssistSource,
    /Text\(controller\.remoteScreenLocked \? "Mac Locked" : "Remote Assist"\)/u,
  );
});

test("Remote Assist lists and focuses Terminal tabs without reading terminal contents", async () => {
  const [
    remoteAssistSource,
    macTerminalTabsSource,
    macPeerSource,
    terminalTabProtocolSource,
    macBuildSource,
  ] = await Promise.all([
    readFile(iosRemoteAssistPath, "utf8"),
    readFile(nativeMacTerminalTabsPath, "utf8"),
    readFile(nativeMacRemotePeerPath, "utf8"),
    readFile(remoteTerminalTabProtocolPath, "utf8"),
    readFile(nativeMacBuildPath, "utf8"),
  ]);

  assert.match(remoteAssistSource, /case terminalTabs/u);
  assert.match(remoteAssistSource, /accessibilityLabel\("Choose Terminal tab"\)/u);
  assert.match(remoteAssistSource, /Text\("Terminal Tabs"\)/u);
  assert.match(remoteAssistSource, /accessibilityLabel\("Back to Remote Assist controls"\)/u);
  assert.match(remoteAssistSource, /accessibilityLabel\("Refresh Terminal tabs"\)/u);
  assert.match(remoteAssistSource, /controller\.focusRemoteTerminalTab\(tab\.id\)/u);
  assert.match(terminalTabProtocolSource, /"terminal\.tabs\.request"/u);
  assert.match(terminalTabProtocolSource, /"terminal\.tabs\.result"/u);
  assert.match(terminalTabProtocolSource, /"terminal\.tab\.focus"/u);
  assert.match(terminalTabProtocolSource, /"terminal\.tab\.focus\.result"/u);
  assert.match(macPeerSource, /MacTerminalTabController\(\)/u);
  assert.match(macTerminalTabsSource, /NSRunningApplication\.runningApplications/u);
  assert.match(macTerminalTabsSource, /set selected tab of targetWindow to tab/u);
  assert.match(macTerminalTabsSource, /set frontmost of targetWindow to true/u);
  assert.match(macTerminalTabsSource, /Privacy_Automation/u);
  assert.match(macTerminalTabsSource, /AEDeterminePermissionToAutomateTarget/u);
  assert.match(macTerminalTabsSource, /typeWildCard,[\s\S]*typeWildCard,[\s\S]*true/u);
  assert.match(macTerminalTabsSource, /permissionRouter\.openAutomationSettings\(\)/u);
  assert.match(macTerminalTabsSource, /Mac System Settings is open/u);
  assert.doesNotMatch(macTerminalTabsSource, /contents of|history of|processes of/u);
  assert.match(macBuildSource, /<key>NSAppleEventsUsageDescription<\/key>/u);
  assert.match(macBuildSource, /current Terminal tab list or choose a tab from Remote Assist/u);
});

test("iPhone Remote Assist dismisses its keyboard before forwarding a viewport tap", async () => {
  const [remoteAssistSource, macPeerSource] = await Promise.all([
    readFile(iosRemoteAssistPath, "utf8"),
    readFile(nativeMacRemotePeerPath, "utf8"),
  ]);
  const toggleKeyboardStart = remoteAssistSource.indexOf("func toggleKeyboard() {");
  const dismissKeyboardStart = remoteAssistSource.indexOf("func dismissKeyboard() {");
  const requestKeyboardFocusStart = remoteAssistSource.indexOf(
    "func requestKeyboardFocus() {",
    dismissKeyboardStart,
  );
  const toggleKeyboardSource = remoteAssistSource.slice(
    toggleKeyboardStart,
    dismissKeyboardStart,
  );
  const dismissKeyboardSource = remoteAssistSource.slice(
    dismissKeyboardStart,
    requestKeyboardFocusStart,
  );
  const handleTapStart = remoteAssistSource.indexOf(
    "@objc func handleTap(_ recognizer: UITapGestureRecognizer) {",
  );
  const handleRightTapStart = remoteAssistSource.indexOf(
    "@objc func handleRightTap(_ recognizer: UITapGestureRecognizer) {",
    handleTapStart,
  );
  const handleTapSource = remoteAssistSource.slice(
    handleTapStart,
    handleRightTapStart,
  );
  const keyboardStateStart = remoteAssistSource.indexOf(
    "private func applyKeyboardState() {",
  );
  const keyboardStateEnd = remoteAssistSource.indexOf(
    "\n  }\n}\n\n#else",
    keyboardStateStart,
  );
  const keyboardStateSource = remoteAssistSource.slice(
    keyboardStateStart,
    keyboardStateEnd,
  );

  assert.notEqual(toggleKeyboardStart, -1);
  assert.notEqual(dismissKeyboardStart, -1);
  assert.notEqual(requestKeyboardFocusStart, -1);
  assert.match(
    dismissKeyboardSource,
    /flushBufferedText\(\)[\s\S]*guard keyboardVisible else \{\s*return\s*\}[\s\S]*keyboardVisible = false/u,
  );
  assert.match(
    toggleKeyboardSource,
    /if keyboardVisible \{[\s\S]*dismissKeyboard\(\)[\s\S]*return/u,
  );
  assert.notEqual(handleTapStart, -1);
  assert.notEqual(handleRightTapStart, -1);
  assert.match(handleTapSource, /let point = normalizedPoint\(/u);
  assert.equal(
    handleTapSource.match(/controller\.dismissKeyboard\(\)/gu)?.length,
    1,
  );
  assert.equal(
    handleTapSource.match(
      /controller\.sendClick\(x: point\.x, y: point\.y\)/gu,
    )?.length,
    1,
  );
  assert.ok(
    handleTapSource.indexOf("controller.dismissKeyboard()") <
      handleTapSource.indexOf("controller.sendClick(x: point.x, y: point.y)"),
  );
  assert.notEqual(keyboardStateStart, -1);
  assert.notEqual(keyboardStateEnd, -1);
  assert.match(
    keyboardStateSource,
    /else if self\.isFirstResponder \{\s*self\.resignFirstResponder\(\)/u,
  );
  assert.match(macPeerSource, /channelConfiguration\.isOrdered = true/u);
});

test("iPhone Remote Assist supports local pinch zoom with accurate controls", async () => {
  const remoteAssistSource = await readFile(iosRemoteAssistPath, "utf8");

  assert.match(remoteAssistSource, /maximumScale: CGFloat = 4/u);
  assert.match(remoteAssistSource, /UIPinchGestureRecognizer/u);
  assert.match(remoteAssistSource, /handleDoubleTap/u);
  assert.match(remoteAssistSource, /if viewport\.isZoomed[\s\S]*viewport\.pan/u);
  assert.match(remoteAssistSource, /Text\("1x"\)/u);
  assert.match(remoteAssistSource, /viewport\.normalizedPoint/u);
  assert.match(remoteAssistSource, /sizeChanged[\s\S]*resetViewport/u);
});

test("Remote Assist exposes acknowledged input and bidirectional clipboard controls", async () => {
  const [
    remoteAssistSource,
    macInputSource,
    macPeerSource,
    macKeyboardLayoutSource,
    sessionStateProtocolSource,
  ] = await Promise.all([
    readFile(iosRemoteAssistPath, "utf8"),
    readFile(nativeMacInputPath, "utf8"),
    readFile(nativeMacRemotePeerPath, "utf8"),
    readFile(nativeMacKeyboardLayoutPath, "utf8"),
    readFile(remoteSessionStateProtocolPath, "utf8"),
  ]);

  assert.match(remoteAssistSource, /controller\.pressEnter\(\)/u);
  assert.match(remoteAssistSource, /PasteButton\(payloadType: String\.self\)/u);
  assert.match(remoteAssistSource, /controller\.copyMacSelectionToPhone\(\)/u);
  assert.match(remoteAssistSource, /focusRequest: controller\.keyboardFocusRequest/u);
  assert.match(remoteAssistSource, /self\.requestKeyboardFocus\(\)/u);
  assert.match(remoteAssistSource, /func deleteBackward\(\) \{\s*onDelete\?\(\)/u);
  assert.match(remoteAssistSource, /UILongPressGestureRecognizer/u);
  assert.match(remoteAssistSource, /controller\.sendPointerDown\(x: point\.x, y: point\.y\)/u);
  assert.match(remoteAssistSource, /controller\.sendPointerDrag\(x: point\.x, y: point\.y\)/u);
  assert.match(remoteAssistSource, /controller\.sendPointerUp\(x: point\.x, y: point\.y\)/u);
  assert.match(remoteAssistSource, /if self\.handleInputResponse\(data\)/u);
  assert.match(remoteAssistSource, /if self\.handleSessionState\(data\)/u);
  assert.match(remoteAssistSource, /self\.handleClipboardResponse\(data\)/u);
  assert.match(remoteAssistSource, /remoteScreenLocked/u);
  assert.match(remoteAssistSource, /Mac locked: secure keyboard mode/u);
  assert.match(remoteAssistSource, /RemoteInputCodec\.encode\(message\)/u);
  assert.match(remoteAssistSource, /pendingInputRequests\[message\.requestId\]/u);
  assert.match(remoteAssistSource, /UIPasteboard\.general\.string = text/u);
  assert.match(macInputSource, /let pasteboard = NSPasteboard\.general/u);
  assert.match(macInputSource, /resolveEditableTarget\(\)/u);
  assert.match(macInputSource, /AXUIElementCopyElementAtPosition/u);
  assert.match(macInputSource, /kAXSelectedTextAttribute/u);
  assert.match(macInputSource, /MacConsoleSessionState\.isLocked\(\)/u);
  assert.match(macInputSource, /MacKeyboardLayout\.keyStrokes\(for: text\)/u);
  assert.match(macInputSource, /isLoginWindow\(pid:/u);
  assert.match(macInputSource, /enqueueTypedClipboardPaste/u);
  assert.match(macInputSource, /pressCommandShortcut\(keyCode: 9, targetPID:/u);
  assert.match(macInputSource, /pressCommandShortcut\(keyCode: 8, targetPID:/u);
  assert.match(macInputSource, /case "down":[\s\S]*\.leftMouseDown/u);
  assert.match(macInputSource, /case "drag":[\s\S]*\.leftMouseDragged/u);
  assert.match(macInputSource, /case "up":[\s\S]*\.leftMouseUp/u);
  assert.match(
    macInputSource,
    /guard let source = CGEventSource\(stateID: \.privateState\) else/u,
  );
  assert.doesNotMatch(macInputSource, /combinedSessionState/u);
  const pointerPostingSource = macInputSource.slice(
    macInputSource.indexOf("private func postMouseEvent("),
    macInputSource.indexOf("private func establishTarget("),
  );
  assert.match(pointerPostingSource, /event\.flags = \[\]/u);
  const scrollPostingSource = macInputSource.slice(
    macInputSource.indexOf("private func handleScroll("),
    macInputSource.indexOf("private func enqueueInput("),
  );
  assert.match(scrollPostingSource, /event\.flags = \[\]/u);
  const cancelInputSource = macInputSource.slice(
    macInputSource.indexOf("func cancelPendingOperations()"),
    macInputSource.indexOf("private func handleClipboard("),
  );
  assert.match(cancelInputSource, /releaseRemoteInputState\(\)/u);
  assert.match(macInputSource, /private func releaseRemoteInputState\(\)/u);
  assert.match(macInputSource, /lastPointerPoint/u);
  assert.match(macInputSource, /activeRemoteModifierKeyCodes/u);
  assert.match(macInputSource, /macRemoteShortcutEventSteps\(for: shortcut\)/u);
  const channelStateSource = macPeerSource.slice(
    macPeerSource.indexOf("private func controlChannelStateChanged()"),
    macPeerSource.indexOf("private func publishSessionState("),
  );
  assert.match(
    channelStateSource,
    /guard controlChannel\?\.readyState == \.open else \{[\s\S]*inputController\.cancelPendingOperations\(\)/u,
  );
  assert.match(macPeerSource, /self\?\.sendControl\(response\)/u);
  assert.match(macPeerSource, /publishSessionState\(force: true\)/u);
  assert.match(macPeerSource, /RemoteSessionStateCodec\.encode\(message\)/u);
  assert.match(macKeyboardLayoutSource, /TISCopyCurrentKeyboardLayoutInputSource/u);
  assert.match(macKeyboardLayoutSource, /UCKeyTranslate/u);
  assert.match(sessionStateProtocolSource, /messageType = "session\.state"/u);
});

test("ClawDad presents its transparent mascot and floating controls with optional thread naming", async () => {
  const [contentSource, cloudSource, cssSource, mascotContents, mascotImage] = await Promise.all([
    readFile(iosContentPath, "utf8"),
    readFile(iosCloudClientPath, "utf8"),
    readFile(webCssPath, "utf8"),
    readFile(iosMascotContentsPath, "utf8"),
    readFile(iosMascotImagePath),
  ]);
  const loadingSource = contentSource.slice(
    contentSource.indexOf("private var startupLoadingView"),
    contentSource.indexOf("private var subscriptionLoadingView"),
  );
  const headerSource = contentSource.slice(
    contentSource.indexOf("private var brandHeader"),
    contentSource.indexOf("private var composerPanel"),
  );
  const iconStyleSource = contentSource.slice(
    contentSource.indexOf("struct ClawDadIconButtonStyle"),
    contentSource.indexOf("struct ClawDadVoiceButtonStyle"),
  );
  const clawStyleSource = contentSource.slice(
    contentSource.indexOf("struct ClawDadClawButtonStyle"),
    contentSource.indexOf("struct ClawDadSegmentButtonStyle"),
  );

  assert.match(loadingSource, /Image\("ClawDadMascot"\)[\s\S]*\.scaledToFit\(\)/u);
  assert.match(headerSource, /Image\("ClawDadMascot"\)[\s\S]*\.scaledToFit\(\)/u);
  assert.doesNotMatch(loadingSource, /\.clipShape\(|RoundedRectangle[\s\S]*\.stroke/u);
  assert.doesNotMatch(headerSource, /\.clipShape\(|RoundedRectangle[\s\S]*\.stroke/u);
  assert.match(mascotContents, /"filename"\s*:\s*"clawdad-mascot\.png"/u);
  assert.ok(mascotImage.length > 100_000, "The transparent mascot asset should contain finished artwork.");

  assert.match(contentSource, /@State private var showingNewThreadPrompt = false/u);
  assert.match(contentSource, /\.alert\("Start New Thread", isPresented: \$showingNewThreadPrompt\)/u);
  assert.match(contentSource, /TextField\("Optional thread name", text: \$newThreadName\)/u);
  assert.match(contentSource, /Button\("Start Thread"\)\s*\{\s*createNewThread\(\)/u);
  assert.equal(contentSource.match(/presentNewThreadPrompt\(\)/gu)?.length, 3);
  assert.match(cloudSource, /func createSession\(title: String = ""\)/u);
  assert.match(cloudSource, /title\.trimmingCharacters\(in: \.whitespacesAndNewlines\)\.prefix\(80\)/u);
  assert.match(cloudSource, /"title": \.string\(normalizedTitle\)/u);

  assert.doesNotMatch(iconStyleSource, /\.background\(|RoundedRectangle/u);
  assert.doesNotMatch(clawStyleSource, /\.background\(|RoundedRectangle/u);
  assert.match(
    cssSource,
    /\.composer-tools-button\.thread-button,[\s\S]*?background: transparent;[\s\S]*?box-shadow: none;/u,
  );
  assert.match(
    cssSource,
    /\.message-audio-button\.copy-button,[\s\S]*?background: transparent;[\s\S]*?box-shadow: none;/u,
  );
});

test("iPhone cold launch hides the fallback workspace until saved selection hydration", async () => {
  const [contentSource, cloudSource] = await Promise.all([
    readFile(iosContentPath, "utf8"),
    readFile(iosCloudClientPath, "utf8"),
  ]);

  assert.match(
    cloudSource,
    /@Published private\(set\) var startupWorkspaceReady = false/u,
  );
  assert.match(
    cloudSource,
    /self\.startupWorkspaceReady = self\.pairedHostId\.isEmpty \|\| self\.pairedHostId != self\.hostId/u,
  );
  assert.match(
    cloudSource,
    /var startupLoading: Bool \{\s*paired && !startupWorkspaceReady\s*\}/u,
  );

  const catalogStart = cloudSource.indexOf('case "catalog.snapshot":');
  const catalogEnd = cloudSource.indexOf('case "models.snapshot":', catalogStart);
  assert.ok(catalogStart >= 0 && catalogEnd > catalogStart);
  const catalogSource = cloudSource.slice(catalogStart, catalogEnd);
  assert.match(catalogSource, /selectedProjectPath = first\.path/u);
  assert.match(catalogSource, /startupWorkspaceReady = true/u);
  assert.ok(
    catalogSource.indexOf("startupWorkspaceReady = true") >
      catalogSource.indexOf("selectedProjectPath = first.path"),
  );

  const connectStart = cloudSource.indexOf("private func connectAsync()");
  const reconnectStart = cloudSource.indexOf("private func handleConnectionLoss", connectStart);
  assert.ok(connectStart >= 0 && reconnectStart > connectStart);
  assert.doesNotMatch(
    cloudSource.slice(connectStart, reconnectStart),
    /startupWorkspaceReady\s*=/u,
  );

  assert.match(
    contentSource,
    /if session\.startupLoading \{\s*startupLoadingView\s*\.transition\(\.opacity\)\s*\} else \{\s*workspaceSurface\s*\.transition\(\.opacity\)/u,
  );
  assert.match(
    contentSource,
    /\.animation\(reduceMotion \? nil : \.easeInOut\(duration: 0\.38\), value: session\.startupLoading\)/u,
  );
  assert.match(contentSource, /accessibilityIdentifier\("clawdad\.startup\.loading"\)/u);
  assert.match(contentSource, /accessibilityIdentifier\("clawdad\.workspace\.ready"\)/u);
  assert.match(contentSource, /private var settingsOverlay: some View/u);
});

test("iPhone keeps transport activity off the workspace and connection status in Settings", async () => {
  const contentSource = await readFile(iosContentPath, "utf8");
  const workspaceStart = contentSource.indexOf("private var workspaceSurface");
  const workspaceEnd = contentSource.indexOf("private var startupLoadingView", workspaceStart);
  const settingsStart = contentSource.indexOf("struct SettingsView");
  assert.ok(workspaceStart >= 0 && workspaceEnd > workspaceStart && settingsStart >= 0);

  const workspaceSource = contentSource.slice(workspaceStart, workspaceEnd);
  const settingsSource = contentSource.slice(settingsStart);
  assert.doesNotMatch(workspaceSource, /activityPanel|Text\("Recent"\)|session\.state\.label/u);
  assert.doesNotMatch(contentSource, /private var activityPanel/u);
  assert.match(settingsSource, /Text\("Connection"\)/u);
  assert.match(settingsSource, /private var connectionTitle: String/u);
  assert.match(settingsSource, /private var connectionDetail: String/u);
});

test("web thread detail modal opens centered in the window", async () => {
  const cssSource = await readFile(webCssPath, "utf8");
  assert.match(cssSource, /#detailModal\s*\{[\s\S]*display: grid;[\s\S]*place-items: center;/u);
  assert.match(cssSource, /#detailModal \.detail-panel\s*\{[\s\S]*position: relative;[\s\S]*left: auto;[\s\S]*bottom: auto;[\s\S]*transform: none;/u);
  assert.match(cssSource, /#detailModal\[hidden\]\s*\{[\s\S]*display: none;/u);
});

test("web response audio no longer exposes the queue auto-audio toggle", async () => {
  const [indexHtml, appSource, cssSource] = await Promise.all([
    readFile(webIndexPath, "utf8"),
    readFile(webAppPath, "utf8"),
    readFile(webCssPath, "utf8"),
  ]);

  assert.doesNotMatch(indexHtml, /audioAutoDownloadButton/u);
  assert.doesNotMatch(indexHtml, /Auto audio/u);
  assert.doesNotMatch(appSource, /audioAutoDownload/u);
  assert.doesNotMatch(cssSource, /audio-auto-download/u);
  assert.match(appSource, /hydrateAudioAvailabilityFromHistoryItem/u);
  assert.match(appSource, /normalizeHistoryAudioMetadata/u);
});

test("web thread cache never persists or restores failed cards", async () => {
  const context = await loadThreadCacheHelpers();
  const failed = {
    requestId: "failed-request",
    projectPath: "/repo/clawdad",
    sessionId: "session-failed",
    provider: "codex",
    message: "This stale local card should not survive reload.",
    sentAt: "2026-05-04T12:00:00.000Z",
    answeredAt: "2026-05-04T12:01:00.000Z",
    status: "failed",
    exitCode: 1,
    response: "Failed.",
  };
  const answered = {
    ...failed,
    requestId: "answered-request",
    sessionId: "session-answered",
    status: "answered",
    exitCode: 0,
    response: "Answered.",
  };
  const queued = {
    ...failed,
    requestId: "queued-request",
    sessionId: "session-queued",
    status: "queued",
    exitCode: null,
    sentAt: new Date().toISOString(),
    answeredAt: null,
    response: "",
  };

  context.state.threadEntries = [failed, answered, queued];
  context.persistThreadEntries();
  const persisted = JSON.parse(context.localStorage.getItem(context.threadCacheKey));
  assert.deepEqual(persisted.map((entry) => entry.status).sort(), ["answered", "queued"]);

  context.localStorage.setItem(context.threadCacheKey, JSON.stringify([failed, answered, queued]));
  context.state.threadEntries = [];
  context.restoreThreadEntries();
  assert.deepEqual(
    JSON.parse(JSON.stringify(context.state.threadEntries.map((entry) => entry.status).sort())),
    ["answered", "queued"],
  );
});

test("web recent history hydration keeps failed cards out of the dashboard queue state", async () => {
  const context = await loadThreadCacheHelpers();
  const failed = {
    requestId: "failed-request",
    projectPath: "/repo/clawdad",
    sessionId: "session-failed",
    provider: "codex",
    message: "This failed card belongs in thread history, not the queue.",
    sentAt: "2026-05-04T12:00:00.000Z",
    answeredAt: "2026-05-04T12:01:00.000Z",
    status: "failed",
    exitCode: 1,
    response: "Failed.",
  };
  const answered = {
    ...failed,
    requestId: "answered-request",
    sessionId: "session-answered",
    status: "answered",
    exitCode: 0,
    response: "Answered.",
  };
  const queued = {
    ...failed,
    requestId: "queued-request",
    sessionId: "session-queued",
    status: "queued",
    exitCode: null,
    answeredAt: null,
    response: "",
  };

  context.hydrateThreadEntriesFromHistoryItems([failed, answered, queued]);

  assert.deepEqual(
    JSON.parse(JSON.stringify(context.state.threadEntries.map((entry) => entry.status).sort())),
    ["answered"],
  );
  assert.equal(
    context.state.historyThreads["/repo/clawdad::session-failed"].items[0].status,
    "failed",
  );
  assert.equal(
    context.state.historyThreads["/repo/clawdad::session-queued"].items[0].status,
    "queued",
  );
});

test("web dashboard queue visibility excludes failed cards still present in memory", async () => {
  const context = await loadThreadCacheHelpers();
  assert.equal(context.threadEntryVisibleInQueue({ status: "queued" }), true);
  assert.equal(context.threadEntryVisibleInQueue({ status: "answered" }), true);
  assert.equal(context.threadEntryVisibleInQueue({ status: "failed" }), false);
  assert.equal(context.threadEntryVisibleInQueue({ status: "FAILED" }), false);
});

test("web dashboard queue visibility excludes completed Direct acknowledgments", async () => {
  const context = await loadThreadCacheHelpers();
  const answer = {
    requestId: "answer-request",
    projectPath: "/repo/clawdad",
    sessionId: "session-a",
    status: "answered",
    scheduleMode: "direct",
    requestState: "completed",
    sentAt: "2026-05-05T12:00:00.000Z",
    answeredAt: "2026-05-05T12:01:00.000Z",
    response: "Finished.",
  };
  const directAck = {
    ...answer,
    requestId: "direct-request",
    scheduleMode: "direct",
    requestState: "direct",
    sentAt: "2026-05-05T12:02:00.000Z",
    answeredAt: "2026-05-05T12:02:01.000Z",
    response: "Sent directly into the active Codex turn.",
  };

  context.state.threadEntries = [answer, directAck];

  assert.equal(context.threadEntryVisibleInQueue(answer), true);
  assert.equal(context.threadEntryVisibleInQueue(directAck), false);
  assert.deepEqual(context.queueEntries().map((entry) => entry.requestId), [answer.requestId]);
});

test("web dashboard queue visibility excludes archived worker cards without dropping cache state", async () => {
  const context = await loadThreadCacheHelpers();
  const archived = {
    requestId: "archived-request",
    projectPath: "/repo/clawdad",
    sessionId: "session-a",
    status: "answered",
    sentAt: "2026-05-05T12:00:00.000Z",
    answeredAt: "2026-05-05T12:01:00.000Z",
    archivedAt: "2026-05-05T12:02:00.000Z",
    response: "Done.",
  };

  context.state.threadEntries = [archived];
  context.persistThreadEntries();
  context.state.threadEntries = [];
  context.restoreThreadEntries();

  assert.equal(context.state.threadEntries.length, 1);
  assert.equal(context.state.threadEntries[0].archivedAt, archived.archivedAt);
  assert.equal(context.threadEntryVisibleInQueue(context.state.threadEntries[0]), false);
  assert.deepEqual(JSON.parse(JSON.stringify(context.queueEntries())), []);
});

test("web dashboard queue visibility excludes stale history queued transcript rows", async () => {
  const context = await loadThreadCacheHelpers();
  const staleQueued = {
    id: "history:codex:session-a:0",
    requestId: "codex:session-a:0",
    projectPath: "/repo/clawdad",
    sessionId: "session-a",
    status: "queued",
    sentAt: "2026-05-04T12:00:00.000Z",
    answeredAt: null,
    response: "",
  };
  const laterAnswer = {
    ...staleQueued,
    id: "history:codex:session-a:1",
    requestId: "codex:session-a:1",
    status: "answered",
    sentAt: "2026-05-04T12:01:00.000Z",
    answeredAt: "2026-05-04T12:02:00.000Z",
    response: "Done.",
  };

  context.state.threadEntries = [staleQueued, laterAnswer];

  assert.equal(context.threadEntryVisibleInQueue(staleQueued), false);
  assert.deepEqual(context.queueEntries().map((entry) => entry.requestId), [laterAnswer.requestId]);
});

test("web dashboard queue visibility only trusts local pending queue rows by default", async () => {
  const context = await loadThreadCacheHelpers();
  const historyQueued = {
    id: "history:codex:session-a:2",
    requestId: "codex:session-a:2",
    projectPath: "/repo/clawdad",
    sessionId: "session-a",
    status: "queued",
    sentAt: new Date().toISOString(),
    answeredAt: null,
    response: "",
  };
  const localQueued = {
    ...historyQueued,
    id: "local-pending",
    requestId: "local-pending",
  };

  context.state.threadEntries = [historyQueued, localQueued];

  assert.equal(context.threadEntryVisibleInQueue(historyQueued), false);
  assert.equal(context.threadEntryVisibleInQueue(localQueued), true);
  assert.deepEqual(context.queueEntries().map((entry) => entry.requestId), [localQueued.requestId]);
});

test("web dashboard queue renders one canonical card per session thread", async () => {
  const context = await loadThreadCacheHelpers();
  const olderAnswer = {
    id: "history:older-answer",
    requestId: "older-answer",
    projectPath: "/repo/clawdad",
    sessionId: "session-a",
    status: "answered",
    sentAt: "2026-05-04T12:00:00.000Z",
    answeredAt: "2026-05-04T12:01:00.000Z",
    response: "Older answer.",
  };
  const newerAnswer = {
    ...olderAnswer,
    id: "history:newer-answer",
    requestId: "newer-answer",
    sentAt: "2026-05-04T12:02:00.000Z",
    answeredAt: "2026-05-04T12:03:00.000Z",
    response: "Newer answer.",
  };
  const activeQueued = {
    ...olderAnswer,
    id: "local-queued",
    requestId: "local-queued",
    status: "queued",
    sentAt: new Date().toISOString(),
    answeredAt: null,
    response: "",
  };
  const otherThread = {
    ...newerAnswer,
    id: "history:other-thread",
    requestId: "other-thread",
    sessionId: "session-b",
  };

  context.state.threadEntries = [olderAnswer, newerAnswer, otherThread];
  assert.deepEqual(
    context.queueEntries().map((entry) => entry.requestId),
    ["newer-answer", "other-thread"],
  );

  context.state.threadEntries = [olderAnswer, newerAnswer, activeQueued, otherThread];
  assert.deepEqual(
    context.queueEntries().map((entry) => entry.requestId),
    ["local-queued", "other-thread"],
  );
});

test("web project dropdown orders projects by latest session thread activity", async () => {
  const context = await loadProjectSortHelpers();
  const alpha = {
    path: "/repo/alpha",
    displayName: "Alpha",
    sessions: [{ lastResponse: "2026-05-04T12:00:00.000Z" }],
  };
  const beta = {
    path: "/repo/beta",
    displayName: "Beta",
    sessions: [{ lastDispatch: "2026-05-04T13:00:00.000Z" }],
  };
  const gamma = {
    path: "/repo/gamma",
    displayName: "Gamma",
    sessions: [],
  };

  context.state.threadEntries = [
    {
      projectPath: "/repo/gamma",
      sessionId: "session-gamma",
      sentAt: "2026-05-04T14:00:00.000Z",
      answeredAt: "",
    },
  ];

  assert.equal(
    context.projectActivityTimestampMs(gamma),
    new Date("2026-05-04T14:00:00.000Z").getTime(),
  );
  assert.deepEqual(
    [alpha, beta, gamma].sort(context.compareProjects).map((project) => project.displayName),
    ["Gamma", "Beta", "Alpha"],
  );
});

test("web project dropdown render key tracks activity sort changes", async () => {
  const source = await readFile(webAppPath, "utf8");
  const groupedStart = source.indexOf("function groupedProjectOptions");
  const renderStart = source.indexOf("function renderProjectOptions", groupedStart);
  const renderEnd = source.indexOf("function updateProjectControlAppearance", renderStart);
  assert.notEqual(groupedStart, -1);
  assert.notEqual(renderStart, -1);
  assert.notEqual(renderEnd, -1);

  const groupedBody = source.slice(groupedStart, renderStart);
  assert.match(groupedBody, /scratchpad: scratchpad\.sort\(compareProjects\)/u);
  assert.match(groupedBody, /roots: \[\.\.\.rootGroups\.values\(\)\]/u);
  assert.match(groupedBody, /projects: group\.projects\.sort\(compareProjects\)/u);
  assert.match(groupedBody, /pinned: pinned\.sort\(compareProjects\)/u);

  const renderBody = source.slice(renderStart, renderEnd);
  assert.match(renderBody, /projectActivityTimestampMs\(project\)/u);
  assert.match(renderBody, /project\.workspaceRootPath/u);
  assert.match(renderBody, /project\.untracked/u);
});

test("web entry copy keys stay scoped to a single card", async () => {
  const context = await loadThreadCacheHelpers();
  const base = {
    projectPath: "/repo/clawdad",
    sessionId: "session-a",
    requestId: "",
    id: "",
    status: "answered",
    answeredAt: "2026-05-04T12:02:00.000Z",
  };

  const first = {
    ...base,
    sentAt: "2026-05-04T12:00:00.000Z",
    message: "First card",
  };
  const second = {
    ...base,
    sentAt: "2026-05-04T12:01:00.000Z",
    message: "Second card",
  };

  assert.notEqual(
    context.entryCopyKey(first, "queue-message", first.message),
    context.entryCopyKey(second, "queue-message", second.message),
  );
  assert.notEqual(
    context.entryCopyKey(first, "history-message", first.message),
    context.entryCopyKey(first, "history-response", "Response"),
  );
});

test("web boot migrates legacy thread caches into stable cache", async () => {
  const context = await loadThreadCacheHelpers();
  const legacyEntry = {
    id: "legacy-entry",
    projectPath: "/tmp/clawdad-project",
    sessionId: "session-legacy",
    requestId: "request-legacy",
    status: "answered",
    message: "Legacy card",
    response: "Legacy response",
    sentAt: "2026-05-06T12:00:00.000Z",
    answeredAt: "2026-05-06T12:00:10.000Z",
  };
  context.localStorage.setItem("clawdad-thread-log-v1-old", JSON.stringify([legacyEntry]));
  context.localStorage.setItem("clawdad-thread-log-v2-old", "[]");
  context.localStorage.setItem(context.threadCacheKey, "[]");

  context.restoreThreadEntries();

  assert.equal(context.localStorage.getItem("clawdad-thread-log-v1-old"), JSON.stringify([legacyEntry]));
  assert.equal(context.localStorage.getItem("clawdad-thread-log-v2-old"), "[]");
  assert.equal(context.state.threadEntries.length, 1);
  assert.equal(context.state.threadEntries[0].requestId, "request-legacy");
  const migrated = JSON.parse(context.localStorage.getItem(context.threadCacheKey));
  assert.equal(migrated.length, 1);
  assert.equal(migrated[0].requestId, "request-legacy");
});

test("web project switch leaves Codex session import discovery lazy", async () => {
  const source = await readFile(webAppPath, "utf8");
  const projectSelectStart = source.indexOf('elements.projectSelect.addEventListener("change"');
  const sessionSelectStart = source.indexOf('elements.sessionSelect.addEventListener("change"', projectSelectStart);
  assert.notEqual(projectSelectStart, -1);
  assert.notEqual(sessionSelectStart, -1);
  assert.ok(sessionSelectStart > projectSelectStart);

  const projectSelectHandler = source.slice(projectSelectStart, sessionSelectStart);
  assert.doesNotMatch(projectSelectHandler, /refreshImportableSessions/u);

  const importModalStart = source.indexOf("async function openSessionImportModal");
  const titleModalStart = source.indexOf("function openSessionTitleModal", importModalStart);
  assert.notEqual(importModalStart, -1);
  assert.notEqual(titleModalStart, -1);
  const importModal = source.slice(importModalStart, titleModalStart);
  assert.match(importModal, /refreshImportableSessions\(project\.path,\s*\{\s*force:\s*true\s*\}\)/u);

  const importButtonStart = source.indexOf("function updateImportButtonAvailability");
  const renameButtonStart = source.indexOf("function updateSessionRenameAvailability", importButtonStart);
  assert.notEqual(importButtonStart, -1);
  assert.notEqual(renameButtonStart, -1);
  assert.ok(renameButtonStart > importButtonStart);
  const importButton = source.slice(importButtonStart, renameButtonStart);
  assert.match(importButton, /if \(!elements\.sessionImportButton\) \{\s*return;\s*\}/u);

  const refreshProjectsStart = source.indexOf("async function refreshProjects");
  const refreshThreadsStart = source.indexOf("async function refreshThreads", refreshProjectsStart);
  assert.notEqual(refreshProjectsStart, -1);
  assert.notEqual(refreshThreadsStart, -1);
  assert.ok(refreshThreadsStart > refreshProjectsStart);
  const refreshProjects = source.slice(refreshProjectsStart, refreshThreadsStart);
  assert.match(
    refreshProjects,
    /if \(state\.sessionImportModalProject === state\.selectedProject\) \{\s*void refreshImportableSessions\(state\.selectedProject\)/u,
  );
  assert.doesNotMatch(refreshProjects, /refreshImportableSessions\(state\.selectedProject,\s*\{\s*force:\s*true/u);
});

test("web background catalog refresh keeps active controls interactive", async () => {
  const source = await readFile(webAppPath, "utf8");
  assert.match(
    source,
    /function catalogIsRefreshing\(\) \{\s*return state\.projectsLoading && state\.projects\.length > 0;\s*\}/u,
  );
  assert.match(
    source,
    /function catalogBlocksInteraction\(\) \{\s*return catalogIsBootstrapping\(\);\s*\}/u,
  );

  const controlsStart = source.indexOf("function updateThreadButtonAvailability");
  const controlsEnd = source.indexOf("function updateQueueChrome", controlsStart);
  assert.notEqual(controlsStart, -1);
  assert.notEqual(controlsEnd, -1);
  assert.ok(controlsEnd > controlsStart);

  const controls = source.slice(controlsStart, controlsEnd);
  assert.match(controls, /catalogBlocksInteraction\(\)/u);
  assert.doesNotMatch(controls, /state\.projectsLoading/u);

  const workspaceTabsStart = source.indexOf("function renderWorkspaceTabs");
  const workspaceTabsEnd = source.indexOf("function renderSelectedProjectDelegateCard", workspaceTabsStart);
  assert.notEqual(workspaceTabsStart, -1);
  assert.notEqual(workspaceTabsEnd, -1);
  assert.ok(workspaceTabsEnd > workspaceTabsStart);
  const workspaceTabs = source.slice(workspaceTabsStart, workspaceTabsEnd);
  assert.match(workspaceTabs, /const hasProject = !catalogBlocksInteraction\(\) && Boolean\(state\.selectedProject\);/u);
  assert.doesNotMatch(workspaceTabs, /state\.projectsLoading/u);
});

test("web files workspace only blocks for catalog bootstrap", async () => {
  const source = await readFile(webAppPath, "utf8");
  const start = source.indexOf("function renderFilesWorkspace");
  const end = source.indexOf("function renderArtifactsModal", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  assert.ok(end > start);

  const filesWorkspace = source.slice(start, end);
  assert.match(filesWorkspace, /const catalogBlocking = catalogBlocksInteraction\(\);/u);
  assert.match(filesWorkspace, /const catalogRefreshing = catalogIsRefreshing\(\);/u);
  assert.match(filesWorkspace, /elements\.filesWorkspaceRefreshButton\.disabled = catalogBlocking \|\| loadingCount > 0;/u);
  assert.doesNotMatch(filesWorkspace, /if \(state\.projectsLoading\)/u);
  assert.doesNotMatch(filesWorkspace, /state\.projectsLoading \|\|/u);
});

test("web queue cards open in-app terminal streams while thread cards generate and play message audio", async () => {
  const [source, html, css] = await Promise.all([
    readFile(webAppPath, "utf8"),
    readFile(webIndexPath, "utf8"),
    readFile(webCssPath, "utf8"),
  ]);

  const renderQueueStart = source.indexOf("function renderQueueList");
  const buildThreadCardStart = source.indexOf("function buildThreadCard", renderQueueStart);
  assert.notEqual(renderQueueStart, -1);
  assert.notEqual(buildThreadCardStart, -1);
  assert.ok(buildThreadCardStart > renderQueueStart);
  const renderQueue = source.slice(renderQueueStart, buildThreadCardStart);
  assert.match(renderQueue, /buildTerminalStreamButton\(entry\)/u);
  assert.doesNotMatch(renderQueue, /buildAudioButton\(/u);

  const streamButtonStart = source.indexOf("function buildTerminalStreamButton");
  const openTerminalButtonStart = source.indexOf("function buildOpenTerminalButton", streamButtonStart);
  assert.notEqual(streamButtonStart, -1);
  assert.notEqual(openTerminalButtonStart, -1);
  const streamButton = source.slice(streamButtonStart, openTerminalButtonStart);
  assert.match(streamButton, /openTerminalStreamPanel\(entry, button\)/u);
  assert.doesNotMatch(streamButton, /openSessionInTerminal/u);

  const buildThreadCardEnd = source.indexOf("function buildHistoryGroup", buildThreadCardStart);
  assert.notEqual(buildThreadCardEnd, -1);
  assert.ok(buildThreadCardEnd > buildThreadCardStart);
  const buildThreadCard = source.slice(buildThreadCardStart, buildThreadCardEnd);
  assert.match(buildThreadCard, /buildAudioControls\(/u);
  assert.match(buildThreadCard, /messageAudioKey\(entry, audioKind, audioText\)/u);
  assert.match(buildThreadCard, /messageAudioPayload\(entry, audioKind, audioText\)/u);
  assert.match(source, /historyRequestId: requestId/u);
  assert.match(source, /:tts:\$\{fingerprint\.dashKey\}/u);
  assert.match(source, /function messageAudioTextFingerprint/u);
  assert.match(source, /clientTextHash: fingerprint\.hash/u);
  assert.match(source, /clientTextLength: fingerprint\.length/u);
  assert.match(source, /historyAudioManifestMatchesVisibleText\(manifest, text\)/u);

  const decorateAudioStart = source.indexOf("function decorateAudioButton");
  const ttsFallbackStart = source.indexOf("function ttsFallbackText", decorateAudioStart);
  assert.notEqual(decorateAudioStart, -1);
  assert.notEqual(ttsFallbackStart, -1);
  const decorateAudio = source.slice(decorateAudioStart, ttsFallbackStart);
  assert.match(decorateAudio, /button\.innerHTML = speakerIconMarkup\(\);/u);
  assert.match(
    decorateAudio,
    /if \(!ready\) \{[\s\S]*?button\.innerHTML = speakerIconMarkup\(\);[\s\S]*?return;\s*\}\s*button\.innerHTML = speakerIconMarkup\(\);/u,
  );
  assert.match(decorateAudio, /button\.innerHTML = audioErrorIconMarkup\(\);/u);
  assert.match(source, /insufficient OpenAI funds or credits/u);
  assert.match(source, /Prepare local audio and play/u);
  assert.match(decorateAudio, /button\.dataset\.audioAction = "tts";/u);
  assert.match(decorateAudio, /button\.classList\.remove\("is-download"\);/u);
  assert.doesNotMatch(source, /function shouldPrepareAudioInBackground/u);
  assert.doesNotMatch(source, /function maybeAutoPrepareMessageAudio/u);
  assert.doesNotMatch(source, /audioAutoPrepareSeen/u);
  assert.doesNotMatch(buildThreadCard, /maybeAutoPrepareMessageAudio/u);
  assert.match(source, /audio\.message/u);
  assert.match(source, /\["message", audio\.message\]/u);
  assert.match(source, /audioManifestReady\(manifest\)/u);
  assert.match(source, /stableCopyHash\(value\)/u);
  assert.match(source, /manifest\.textHash \|\| manifest\.source\?\.textHash/u);
  assert.doesNotMatch(source, /audioAutoplayAfterPrepare/u);
  assert.doesNotMatch(source, /fromPrepare/u);
  assert.doesNotMatch(source, /downloadIconMarkup/u);
  assert.match(source, /const threadCacheKey = "clawdad-thread-log-v2";/u);
  assert.doesNotMatch(source, /const threadCacheKey = `clawdad-thread-log-v2\$\{cacheVersionSuffix\}`/u);
  assert.match(source, /fetchJson\("\/v1\/tts\/status"\)/u);
  assert.match(source, /ttsStatusBlocksGeneration/u);
  assert.doesNotMatch(html, /Enable automatic audio downloads/u);
  assert.doesNotMatch(html, /Enable automatic AI audio preparation/u);
  assert.doesNotMatch(source, /audioAutoDownload/u);
  assert.doesNotMatch(source, /silentAudioDataUri/u);
  assert.doesNotMatch(source, /unlockMessageAudioPlayback/u);
  assert.doesNotMatch(source, /settleMessageAudioUnlock/u);
  assert.match(source, /const audioPlaybackStartTimeoutMs/u);
  assert.match(source, /function reserveMessageAudioPlayback/u);
  assert.match(source, /function primeMessageAudioPlayback/u);
  assert.match(source, /createSilentWavObjectUrl/u);
  assert.match(source, /primeMessageAudioPlayback\(audioKey\);/u);
  assert.match(source, /function startReadyMessageAudioPlayback/u);
  assert.match(source, /function prepareAndPlayMessageAudio/u);
  assert.match(source, /function prepareMessageAudioPartsForPlayback/u);
  assert.match(source, /const audioPreparePlaybackPromises = new Map\(\);/u);
  assert.match(source, /return prepareAndPlayMessageAudio\(audioKey, payload\);/u);
  assert.match(source, /background: poll,\s*poll,/u);
  assert.match(source, /function diagnosticFetchAudioUrl/u);
  assert.match(source, /range: "bytes=0-0"/u);
  assert.match(source, /showAudioStatus\("Preparing audio"\)/u);
  assert.match(source, /showAudioStatus\("Starting audio"\)/u);
  assert.match(source, /Audio is ready\. Tap the speaker again to play it\./u);
  assert.match(source, /handleMessageAudioPlaybackError\(audioKey, error\)/u);
  assert.match(source, /class="audio-loading-spinner"/u);
  assert.match(source, /audio-loading-spinner__rotor/u);
  assert.match(source, /audio-loading-spinner__arc/u);
  assert.match(source, /function syncAudioLoadingSpinnerAnimation/u);
  assert.match(source, /requestAnimationFrame\(updateAudioLoadingSpinnerFrame\)/u);
  assert.match(source, /syncAudioLoadingSpinnerAnimation\(\);/u);
  assert.match(css, /\.audio-loading-spinner__rotor/u);
  assert.match(css, /@keyframes audio-spinner-dash/u);
  assert.match(css, /@keyframes audio-loading-dot/u);
  assert.match(
    source,
    /audio\.src = url;\s*audio\.load\(\);\s*let playPromise;\s*try \{\s*playPromise = audio\.play\(\);/u,
  );
  assert.doesNotMatch(source, /autoplay: true/u);
  assert.doesNotMatch(source, /preparedDuringThisTap && mobileAudioNeedsFreshTap\(\)/u);
  assert.match(source, /audio\.addEventListener\("playing", onPlaying/u);
  assert.match(source, /Audio playback did not start\. Tap play again\./u);
  assert.match(source, /function pauseActiveMessageAudio/u);
  assert.match(source, /function resumeActiveMessageAudio/u);
  assert.match(source, /playback\.finishCurrent\(\);/u);
  assert.match(source, /button\.innerHTML = pauseAudioIconMarkup\(\);/u);
  assert.match(source, /button\.innerHTML = playAudioIconMarkup\(\);/u);
  assert.match(source, /function buildAudioStopButton/u);
  assert.match(source, /message-audio-stop-button/u);
  assert.match(css, /\.thread-card:has\(\.message-audio-stop-button:not\(\[hidden\]\)\) \.message-audio-button\.copy-button-floating/u);
});

test("web composer exposes open terminal for the selected session", async () => {
  const [source, html] = await Promise.all([
    readFile(webAppPath, "utf8"),
    readFile(webIndexPath, "utf8"),
  ]);

  assert.match(html, /id="currentTerminalButton"/u);
  assert.match(html, /class="composer-tools-item composer-terminal-button open-terminal-button"/u);
  assert.match(html, /aria-label="Open selected session in terminal"/u);

  assert.match(source, /currentTerminalButton: document\.querySelector\("#currentTerminalButton"\)/u);
  assert.match(source, /function currentSessionTerminalEntry\(\)/u);
  assert.match(source, /function updateComposerTerminalButtonAvailability\(\)/u);
  assert.match(source, /button\.classList\.contains\("composer-tools-item"\)/u);
  assert.match(source, /<span class="button-text">\$\{visibleLabel\}<\/span>/u);
  assert.match(source, /decorateOpenTerminalButton\(elements\.currentTerminalButton, launchKey\)/u);
  assert.match(source, /openSessionInTerminal\(currentSessionTerminalEntry\(\)\)/u);

  const renderAllStart = source.indexOf("function renderAll");
  const reconcileStart = source.indexOf("async function reconcileThreadEntries", renderAllStart);
  assert.notEqual(renderAllStart, -1);
  assert.notEqual(reconcileStart, -1);
  const renderAll = source.slice(renderAllStart, reconcileStart);
  assert.match(renderAll, /refreshCopyButtons\(\);\s*updateComposerTerminalButtonAvailability\(\);/u);
});

test("web terminal stream panel renders request log controls and keeps desktop launcher behind Open In Terminal", async () => {
  const [source, html, css] = await Promise.all([
    readFile(webAppPath, "utf8"),
    readFile(webIndexPath, "utf8"),
    readFile(webCssPath, "utf8"),
  ]);

  assert.match(html, /id="terminalPanel"/u);
  assert.match(html, /id="terminalPanelBack"/u);
  assert.match(html, /id="terminalStreamList"/u);
  assert.match(html, /id="terminalPanelOpenExternal"/u);
  assert.match(html, />Open In Terminal</u);

  assert.match(source, /terminalPanel:\s*\{/u);
  assert.match(source, /function openTerminalStreamPanel\(entry, trigger = null\)/u);
  assert.match(source, /fetchJson\(`\/v1\/session-terminal-log\?\$\{query\.toString\(\)\}`\)/u);
  assert.match(source, /function scheduleTerminalPanelPoll\(\)/u);
  assert.match(source, /terminalPanelStickToBottom/u);
  assert.match(source, /function closeTerminalStreamPanel\(\{ fromHistory = false, restoreFocus = true \} = \{\}\)/u);
  assert.match(source, /window\.history\.pushState/u);
  assert.match(source, /window\.addEventListener\("popstate"/u);

  const openExternalStart = source.indexOf("elements.terminalPanelOpenExternal?.addEventListener");
  const detailScrollStart = source.indexOf("elements.detailScrollBottomButton", openExternalStart);
  assert.notEqual(openExternalStart, -1);
  assert.notEqual(detailScrollStart, -1);
  const openExternalListener = source.slice(openExternalStart, detailScrollStart);
  assert.match(openExternalListener, /openSessionInTerminal\(\{\s*projectPath: state\.terminalPanel\.projectPath,\s*sessionId: state\.terminalPanel\.sessionId,/u);

  assert.match(css, /\.terminal-panel/u);
  assert.match(css, /\.terminal-panel-shell/u);
  assert.match(css, /\.terminal-stream-list/u);
  assert.match(css, /\.terminal-panel-actions\s*\{\s*position: sticky;/u);
});

test("web session dropdown exposes a start-new-session option", async () => {
  const source = await readFile(webAppPath, "utf8");

  assert.match(source, /const newSessionSelectValue = "__clawdad_new_session__";/u);
  assert.match(source, /newOption\.value = newSessionSelectValue/u);
  assert.match(source, /Start new Codex session/u);
  assert.match(source, /async function handleSessionCreate\(\)/u);
  assert.match(source, /fetchJson\("\/v1\/sessions"/u);
  assert.match(source, /if \(sessionId === newSessionSelectValue\) \{\s*await handleSessionCreate\(\);/u);

  const renderStart = source.indexOf("function renderSessionOptions");
  const repoStart = source.indexOf("function repoOptionLabel", renderStart);
  assert.notEqual(renderStart, -1);
  assert.notEqual(repoStart, -1);
  const renderSessionOptions = source.slice(renderStart, repoStart);
  assert.match(renderSessionOptions, /state\.sessionCreatePending/u);
  assert.match(renderSessionOptions, /elements\.sessionSelect\.disabled = disabled;/u);

  const createStart = source.indexOf("async function handleSessionCreate");
  const loadHistoryStart = source.indexOf("async function loadSessionHistory", createStart);
  assert.notEqual(createStart, -1);
  assert.notEqual(loadHistoryStart, -1);
  const createBody = source.slice(createStart, loadHistoryStart);
  assert.match(createBody, /state\.sessionCreatePending = true;/u);
  assert.match(createBody, /provider: project\.provider \|\| "codex"/u);
  assert.match(createBody, /projectWithActiveSession\(payload\.projectDetails, payload\.sessionId\)/u);
  assert.match(createBody, /state\.selectedSessionId = payload\.sessionId;/u);
  assert.match(createBody, /syncSelectedSession\(payload\.sessionId/u);
});

test("Mac workspace exposes project parity controls and scoped recent threads", async () => {
  const [source, html, css] = await Promise.all([
    readFile(webAppPath, "utf8"),
    readFile(webIndexPath, "utf8"),
    readFile(webCssPath, "utf8"),
  ]);

  assert.match(html, /id="projectSelect"[^>]*hidden/u);
  assert.match(html, /id="projectPickerButton"[\s\S]*aria-controls="projectPickerModal"/u);
  assert.match(html, /id="projectAddButton"[\s\S]*aria-label="Create project directory"/u);
  assert.match(html, /id="sessionAddButton"[\s\S]*aria-label="Start new Codex session"/u);
  assert.match(html, /id="projectPickerModal"[\s\S]*id="projectPickerSearchInput"/u);
  assert.match(html, /id="projectPickerAddExistingButton"[\s\S]*>Add Existing</u);
  assert.match(html, /id="threadPreviewPanel"[\s\S]*id="threadScopeProjectButton"[\s\S]*id="threadScopeAllButton"/u);
  assert.match(html, /id="projectDestination"[\s\S]*id="projectDestinationValue"/u);
  assert.match(html, /class="project-mode-tabs"[^>]*hidden/u);

  assert.match(source, /const threadScopeKey = "clawdad-thread-scope-v1";/u);
  assert.match(source, /function renderProjectPickerModal\(\)/u);
  assert.match(source, /function renderThreadPreviewPanel\(\)/u);
  assert.match(source, /function mergeRecentThreadSummaries\(threads = \[\]\)/u);
  assert.match(source, /state\.recentThreads = Array\.isArray\(payload\.recentThreads\)/u);
  assert.match(source, /recentThreads: Array\.isArray\(payload\.recentThreads\)/u);
  assert.match(source, /restoreThreadScope\(\);/u);
  assert.match(source, /openProjectModal\(\{\s*mode: "new",\s*returnFocus: elements\.projectAddButton,/u);
  assert.match(source, /openProjectModal\(\{\s*mode: "existing",\s*returnToPicker: true,/u);
  assert.match(source, /elements\.sessionAddButton\?\.addEventListener\("click"/u);
  assert.match(source, /setThreadScope\("project"\)/u);
  assert.match(source, /setThreadScope\("all"\)/u);

  const createStart = source.indexOf("async function handleProjectCreate");
  const dispatchStart = source.indexOf("async function handleDispatch", createStart);
  assert.notEqual(createStart, -1);
  assert.notEqual(dispatchStart, -1);
  const createBody = source.slice(createStart, dispatchStart);
  const pendingStart = createBody.indexOf("state.projectModalPending = true");
  const fetchStart = createBody.indexOf('fetchJson("/v1/projects"');
  const closeStart = createBody.indexOf("state.projectModalOpen = false");
  assert.ok(pendingStart >= 0 && pendingStart < fetchStart);
  assert.ok(fetchStart >= 0 && fetchStart < closeStart);
  assert.match(createBody, /state\.projectModalStatus = error\.message/u);

  assert.match(css, /\.app-shell\s*\{[\s\S]*width: min\(100%, 960px\);/u);
  assert.match(css, /\.thread-preview-list\s*\{[\s\S]*repeat\(auto-fit, minmax\(290px, 1fr\)\)/u);
  assert.match(css, /\.project-picker-option:hover:not\(:disabled\)/u);
  assert.match(css, /#projectPickerModal\s*\{[\s\S]*place-items: center;/u);
});

test("Mac project directory validation mirrors the paired iPhone and server boundary", async () => {
  const source = await readFile(webAppPath, "utf8");
  const start = source.indexOf("function projectDirectoryNameIsValid");
  const end = source.indexOf("function renderProjectModal", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const context = {};
  vm.createContext(context);
  vm.runInContext(
    `${source.slice(start, end)}\nglobalThis.projectDirectoryNameIsValid = projectDirectoryNameIsValid;`,
    context,
  );

  assert.equal(context.projectDirectoryNameIsValid("clawdad-market"), true);
  assert.equal(context.projectDirectoryNameIsValid(" Beach Planning "), true);
  assert.equal(context.projectDirectoryNameIsValid(""), false);
  assert.equal(context.projectDirectoryNameIsValid(".hidden"), false);
  assert.equal(context.projectDirectoryNameIsValid("nested/project"), false);
  assert.equal(context.projectDirectoryNameIsValid("nested\\project"), false);
  assert.equal(context.projectDirectoryNameIsValid(`bad${String.fromCharCode(7)}name`), false);
});

test("Mac recent-thread scope persists, filters, deduplicates, sorts, and caps cards", async () => {
  const source = await readFile(webAppPath, "utf8");
  const start = source.indexOf("function normalizeThreadScope");
  const end = source.indexOf("function currentThreadEntries", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  const storage = new Map();
  const state = {
    threadScope: "project",
    recentThreads: [],
    projects: [],
    selectedProject: "",
  };
  const context = {
    state,
    threadScopeKey: "clawdad-thread-scope-v1",
    localStorage: {
      getItem(key) {
        return storage.has(key) ? storage.get(key) : null;
      },
      setItem(key, value) {
        storage.set(key, value);
      },
    },
    renderAll() {},
    timestampToMs(value) {
      const parsed = new Date(value || 0).getTime();
      return Number.isFinite(parsed) ? parsed : 0;
    },
    sessionDisplayTitle(session) {
      return session?.title || session?.slug || "Codex thread";
    },
    currentProject() {
      return state.projects.find((project) => project.path === state.selectedProject) || null;
    },
  };
  vm.createContext(context);
  vm.runInContext(
    `${source.slice(start, end)}\nObject.assign(globalThis, { restoreThreadScope, setThreadScope, threadPreviewCards });`,
    context,
  );

  context.restoreThreadScope();
  assert.equal(state.threadScope, "project");
  context.setThreadScope("all");
  assert.equal(storage.get("clawdad-thread-scope-v1"), "all");
  storage.set("clawdad-thread-scope-v1", "unsupported");
  context.restoreThreadScope();
  assert.equal(state.threadScope, "project");

  state.threadScope = "all";
  state.recentThreads = Array.from({ length: 22 }, (_, index) => ({
    projectName: index % 2 === 0 ? "Alpha" : "Beta",
    projectPath: index % 2 === 0 ? "/alpha" : "/beta",
    sessionId: `session-${index}`,
    title: `Thread ${index}`,
    status: "idle",
    lastActivityAt: new Date(Date.UTC(2026, 7, 7, 12, index)).toISOString(),
  }));
  state.recentThreads.push({
    projectName: "Alpha",
    projectPath: "/alpha",
    sessionId: "session-21",
    title: "Stale duplicate",
    status: "idle",
    lastActivityAt: "2026-08-01T00:00:00.000Z",
  });
  const allCards = context.threadPreviewCards();
  assert.equal(allCards.length, 20);
  assert.equal(allCards[0].sessionId, "session-21");
  assert.equal(allCards[0].title, "Thread 21");
  assert.equal(new Set(allCards.map((thread) => thread.sessionId)).size, 20);

  state.projects = [
    {
      path: "/alpha",
      displayName: "Alpha",
      provider: "codex",
      sessions: [
        { sessionId: "alpha-new", title: "New", lastActivityAt: "2026-08-07T12:00:00.000Z" },
        { sessionId: "alpha-old", title: "Old", lastActivityAt: "2026-08-06T12:00:00.000Z" },
      ],
    },
    {
      path: "/beta",
      displayName: "Beta",
      provider: "codex",
      sessions: [
        { sessionId: "beta-new", title: "Other", lastActivityAt: "2026-08-08T12:00:00.000Z" },
      ],
    },
  ];
  state.threadScope = "project";
  state.selectedProject = "/alpha";
  assert.deepEqual(
    [...context.threadPreviewCards().map((thread) => thread.sessionId)],
    ["alpha-new", "alpha-old"],
  );
  state.selectedProject = "/missing";
  assert.deepEqual([...context.threadPreviewCards()], []);

  const renderStart = source.indexOf("function buildThreadPreviewCard");
  const renderEnd = source.indexOf("function repoOptionLabel", renderStart);
  const renderBody = source.slice(renderStart, renderEnd);
  assert.match(renderBody, /openSessionThread\(thread\.projectPath, thread\.sessionId\)/u);
  assert.match(renderBody, /Refreshing threads…/u);
  assert.match(renderBody, /No Codex threads in your workspace yet\./u);
  assert.match(renderBody, /No Codex threads in this directory yet\./u);
  assert.match(renderBody, /state\.threadPreviewError/u);
});

test("web quick chats render as a composer dropdown instead of a modal or linear tray", async () => {
  const [source, html] = await Promise.all([
    readFile(webAppPath, "utf8"),
    readFile(webIndexPath, "utf8"),
  ]);

  const actionsStart = html.indexOf('class="composer-actions"');
  const toolsButtonStart = html.indexOf('id="composerToolsButton"', actionsStart);
  const toolsMenuStart = html.indexOf('id="composerToolsMenu"', actionsStart);
  const quickButtonStart = html.indexOf('id="quickPromptButton"', actionsStart);
  const quickStart = html.indexOf('id="quickPromptModal"', actionsStart);
  const terminalStart = html.indexOf('id="currentTerminalButton"', actionsStart);
  assert.notEqual(actionsStart, -1);
  assert.notEqual(toolsButtonStart, -1);
  assert.notEqual(toolsMenuStart, -1);
  assert.notEqual(quickButtonStart, -1);
  assert.notEqual(quickStart, -1);
  assert.notEqual(terminalStart, -1);
  assert.ok(toolsButtonStart > actionsStart);
  assert.ok(toolsMenuStart > toolsButtonStart);
  assert.ok(quickButtonStart > toolsMenuStart);
  assert.ok(terminalStart > quickButtonStart);
  assert.ok(quickStart > terminalStart);

  const quickMarkupEnd = html.indexOf('id="dispatchButton"', quickStart);
  const quickMarkup = html.slice(quickStart, quickMarkupEnd);
  assert.match(quickMarkup, /class="quick-prompt-dropdown quick-prompt-panel"/u);
  assert.match(quickMarkup, />Quick Chats</u);
  assert.doesNotMatch(quickMarkup, /detail-modal/u);
  assert.doesNotMatch(quickMarkup, /aria-modal="true"/u);
  assert.doesNotMatch(quickMarkup, /role="dialog"/u);
  assert.doesNotMatch(quickMarkup, /<form id="quickPromptForm"/u);
  assert.match(quickMarkup, /<div id="quickPromptForm" class="quick-prompt-form" hidden>/u);
  assert.match(quickMarkup, /id="quickPromptSaveButton"[\s\S]*type="button"/u);
  assert.match(html.slice(quickButtonStart, quickStart), /aria-controls="quickPromptModal"/u);
  assert.match(html.slice(quickButtonStart, quickStart), /aria-haspopup="true"/u);

  assert.match(source, /function renderQuickPromptModal\(\)/u);
  assert.match(source, /function saveQuickPromptDraft\(\)/u);

  const bodyModalStart = source.indexOf("function updateBodyModalState");
  const projectModalStart = source.indexOf("function renderProjectModal", bodyModalStart);
  assert.notEqual(bodyModalStart, -1);
  assert.notEqual(projectModalStart, -1);
  const bodyModal = source.slice(bodyModalStart, projectModalStart);
  assert.doesNotMatch(bodyModal, /quickPromptModalOpen/u);

  const openStart = source.indexOf("function openQuickPromptModal");
  const closeStart = source.indexOf("function closeQuickPromptModal", openStart);
  assert.notEqual(openStart, -1);
  assert.notEqual(closeStart, -1);
  const openBody = source.slice(openStart, closeStart);
  assert.doesNotMatch(openBody, /state\.modalThread = null/u);
  assert.doesNotMatch(openBody, /state\.projectModalOpen = false/u);

  const quickButtonListenerStart = source.indexOf("elements.quickPromptButton?.addEventListener");
  const quickBackdropListenerStart = source.indexOf("elements.quickPromptBackdrop", quickButtonListenerStart);
  assert.notEqual(quickButtonListenerStart, -1);
  assert.notEqual(quickBackdropListenerStart, -1);
  const quickButtonListener = source.slice(quickButtonListenerStart, quickBackdropListenerStart);
  assert.match(quickButtonListener, /if \(state\.quickPromptModalOpen\) \{\s*closeQuickPromptModal\(\);/u);
  assert.match(source, /function isQuickPromptTarget\(target\)/u);
  assert.match(source, /elements\.quickPromptModal\?\.contains\(target\)/u);
  assert.match(source, /elements\.quickPromptButton\?\.contains\(target\)/u);
  assert.match(source, /function isComposerToolsTarget\(target\)/u);
  assert.match(source, /state\.composerToolsOpen && !isComposerToolsTarget\(event\.target\)/u);
  assert.match(quickButtonListener, /document\.addEventListener\("pointerdown"/u);
  assert.match(quickButtonListener, /isQuickPromptTarget\(event\.target\)/u);
  assert.match(quickButtonListener, /closeQuickPromptModal\(\{ focusComposer: false \}\)/u);

  const goBackStart = source.indexOf("function goBackOneStep()");
  const bindStart = source.indexOf("function bindEvents()", goBackStart);
  assert.notEqual(goBackStart, -1);
  assert.notEqual(bindStart, -1);
  const goBackBody = source.slice(goBackStart, bindStart);
  assert.ok(goBackBody.indexOf("terminalPanelIsOpen()") < goBackBody.indexOf("state.queueArchiveConfirmEntryId"));
  assert.ok(goBackBody.indexOf("state.projectModalOpen") < goBackBody.indexOf("state.projectPickerOpen"));
  assert.ok(goBackBody.indexOf("state.quickPromptModalOpen") < goBackBody.indexOf("state.composerToolsOpen"));
  assert.match(goBackBody, /closeTerminalStreamPanel\(\);/u);
  assert.match(goBackBody, /closeQuickPromptModal\(\);/u);
  assert.match(goBackBody, /closeComposerToolsMenu\(\);/u);
  assert.match(
    source,
    /if \(event\.key === "Escape" && goBackOneStep\(\)\) \{\s*event\.preventDefault\(\);/u,
  );

  const saveListenerStart = source.indexOf("elements.quickPromptSaveButton?.addEventListener");
  const titleListenerStart = source.indexOf("elements.quickPromptTitleInput?.addEventListener", saveListenerStart);
  assert.notEqual(saveListenerStart, -1);
  assert.notEqual(titleListenerStart, -1);
  const saveListenerBody = source.slice(saveListenerStart, titleListenerStart);
  assert.doesNotMatch(saveListenerBody, /quickPromptForm\?\.addEventListener\("submit"/u);
  assert.match(saveListenerBody, /quickPromptSaveButton\?\.addEventListener\("click"/u);
  assert.match(saveListenerBody, /quickPromptForm\?\.addEventListener\("keydown"/u);

  const css = await readFile(path.join(repoRoot, "web", "app.css"), "utf8");
  const dropdownStart = css.indexOf(".quick-prompt-dropdown");
  const listStart = css.indexOf(".quick-prompt-list", dropdownStart);
  assert.notEqual(dropdownStart, -1);
  assert.notEqual(listStart, -1);
  const dropdownCss = css.slice(dropdownStart, listStart);
  assert.match(dropdownCss, /position: absolute;/u);
  assert.match(dropdownCss, /bottom: calc\(100% \+ 8px\);/u);
  assert.match(dropdownCss, /width: min\(420px, calc\(100vw - 40px\)\);/u);
  assert.match(css, /\.composer-tools-menu/u);
  assert.match(css, /\.composer-tools-claw/u);
});

test("web composer can attach files and dispatch them with FormData", async () => {
  const [source, html] = await Promise.all([
    readFile(webAppPath, "utf8"),
    readFile(webIndexPath, "utf8"),
  ]);

  assert.match(html, /id="composerAttachmentInput"[\s\S]*?type="file"[\s\S]*?multiple/u);
  assert.match(html, /id="composerAttachmentInput"[\s\S]*?accept="[^"]*image\/\*[^"]*\.heic[^"]*"/u);
  assert.match(html, /id="composerAttachmentList"[^>]*class="composer-attachment-list"/u);
  assert.match(html, /id="composerAttachmentButton"/u);
  assert.match(html, /aria-label="Attach files"/u);

  const actionsStart = html.indexOf('class="composer-actions"');
  const toolsMenuStart = html.indexOf('id="composerToolsMenu"', actionsStart);
  const quickButtonStart = html.indexOf('id="quickPromptButton"', toolsMenuStart);
  const attachmentButtonStart = html.indexOf('id="composerAttachmentButton"', actionsStart);
  const terminalButtonStart = html.indexOf('id="currentTerminalButton"', actionsStart);
  assert.ok(toolsMenuStart > actionsStart);
  assert.ok(quickButtonStart > actionsStart);
  assert.ok(attachmentButtonStart > quickButtonStart);
  assert.ok(terminalButtonStart > attachmentButtonStart);

  assert.match(source, /composerAttachments: \[\]/u);
  assert.match(source, /composerAttachmentButton: document\.querySelector\("#composerAttachmentButton"\)/u);
  assert.match(source, /function renderComposerAttachments\(\)/u);
  assert.match(source, /function addComposerFiles\(files\)/u);
  assert.match(source, /function clearComposerAttachments\(\)/u);
  assert.match(source, /heic\|heif\|jpe\?g/u);
  assert.match(source, /new FormData\(\)/u);
  assert.match(source, /formData\.append\("attachments", attachment\.file, attachment\.fileName\)/u);
  assert.match(source, /message: dispatchMessage/u);
  assert.match(source, /clearComposerAttachments\(\);/u);
  assert.match(source, /buildMessageAttachmentList\(entry\.attachments\)/u);
  assert.match(source, /attachments: composerAttachments\.map\(composerAttachmentSummary\)/u);

  const updateSendStart = source.indexOf("function updateSendAvailability");
  const updateThreadStart = source.indexOf("function updateThreadButtonAvailability", updateSendStart);
  assert.notEqual(updateSendStart, -1);
  assert.notEqual(updateThreadStart, -1);
  const updateSend = source.slice(updateSendStart, updateThreadStart);
  assert.match(updateSend, /state\.composerAttachments\.length > 0/u);
  assert.match(updateSend, /hasDraft/u);
});

test("web composer exposes Direct and Queue dispatch modes", async () => {
  const [source, html, css] = await Promise.all([
    readFile(webAppPath, "utf8"),
    readFile(webIndexPath, "utf8"),
    readFile(path.join(repoRoot, "web", "app.css"), "utf8"),
  ]);

  assert.match(html, /id="composerToolsButton"/u);
  assert.match(html, /src="\/assets\/clawdad-claw-hyperreal-icon\.png"/u);
  assert.doesNotMatch(html, /id="composerToolsModeLabel"/u);
  assert.match(html, /id="dispatchButton"[^>]*>\s*<span class="button-text">Send \(Direct\)<\/span>/u);
  assert.match(html, /data-dispatch-mode="direct"/u);
  assert.match(html, /data-dispatch-mode="queue"/u);
  assert.doesNotMatch(html, /data-dispatch-mode="(?:linear|interject)"/u);
  assert.match(html, /id="composerAccessSelect"/u);
  assert.match(html, /<option value="repo">Repo scoped<\/option>/u);
  assert.match(html, /<option value="full">Full access<\/option>/u);
  const actionsStart = html.indexOf('class="composer-actions"');
  const sendStart = html.indexOf('id="dispatchButton"', actionsStart);
  const modeStart = html.indexOf('id="composerToolsButton"', actionsStart);
  const toolsMenuStart = html.indexOf('id="composerToolsMenu"', actionsStart);
  assert.ok(sendStart > actionsStart);
  assert.ok(modeStart > actionsStart);
  assert.ok(modeStart < sendStart);
  assert.ok(toolsMenuStart > modeStart);
  assert.ok(toolsMenuStart < sendStart);
  assert.match(source, /dispatchMode: "direct"/u);
  assert.match(source, /accessMode: "repo"/u);
  assert.match(source, /const dispatchModes = \["direct", "queue"\]/u);
  assert.match(source, /const accessModes = \["repo", "full"\]/u);
  assert.match(source, /function permissionModeForAccessMode/u);
  assert.match(source, /function cycleDispatchMode\(\)/u);
  assert.match(source, /function setDispatchMode\(mode/u);
  assert.match(source, /function setAccessMode\(mode/u);
  assert.match(source, /function dispatchModeAllowsBusySend/u);
  assert.match(source, /function dispatchButtonText/u);
  assert.match(source, /return `Send \(\$\{modeLabel\}\)`/u);
  assert.match(source, /return `Working \(\$\{modeLabel\}\)`/u);
  assert.match(source, /elements\.composerToolsButton\?\.addEventListener\("click", toggleComposerToolsMenu\)/u);
  assert.match(source, /for \(const button of elements\.dispatchModeButtons\)/u);
  assert.match(source, /elements\.composerAccessSelect\?\.addEventListener\("change"/u);
  assert.match(source, /formData\.append\("dispatchMode", dispatchMode\)/u);
  assert.match(source, /formData\.append\("permissionMode", permissionMode\)/u);
  assert.match(source, /permissionMode,/u);
  assert.match(source, /dispatchMode,/u);
  assert.match(source, /!allowBusySend && pendingEntryForSession/u);
  assert.match(source, /!allowBusySend && sessionIsBusy/u);
  assert.match(source, /const directAccepted = Boolean\(payload\.direct \|\| payload\.interjected\)/u);
  assert.match(source, /payload\.requestId \|\| payload\.queueId/u);
  assert.match(source, /handoffPending/u);
  assert.match(css, /\.composer-tools-button/u);
  assert.match(css, /\.composer-mode-options/u);
  assert.match(css, /\.composer-access-select/u);
  assert.match(css, /grid-template-columns: 48px minmax\(0, 1fr\) 48px;/u);
});

test("web queue cards expose swipe-left archive confirmation", async () => {
  const [source, html, css] = await Promise.all([
    readFile(webAppPath, "utf8"),
    readFile(webIndexPath, "utf8"),
    readFile(path.join(repoRoot, "web", "app.css"), "utf8"),
  ]);

  assert.match(html, /id="queueArchiveModal"/u);
  assert.match(html, /id="queueArchiveCancelButton"/u);
  assert.match(html, /id="queueArchiveConfirmButton"/u);
  assert.match(source, /function attachQueueCardArchiveSwipe/u);
  assert.match(source, /openQueueArchiveConfirm\(entry, card\)/u);
  assert.match(source, /function archiveQueueEntry/u);
  assert.match(source, /const archivedAt = new Date\(\)\.toISOString\(\)/u);
  assert.match(source, /threadEntryIsArchived\(entry\)/u);
  assert.match(css, /\.queue-card\.is-swiping::after/u);
  assert.match(css, /\.queue-card-archive-button/u);
});

test("web history merge preserves outbound attachment summaries", async () => {
  const { mergeHistoryItems } = await loadHistoryMergeHelpers();
  const queued = {
    requestId: "req-attach",
    projectPath: "/repo/clawdad",
    sessionId: "session-1",
    message: "Please review the attached file(s).",
    sentAt: "2026-05-05T12:00:00.000Z",
    status: "queued",
    attachments: [
      {
        id: "att-1",
        fileName: "screen.png",
        size: 4,
        mimeType: "image/png",
        kind: "image",
      },
    ],
  };
  const answered = {
    ...queued,
    status: "answered",
    answeredAt: "2026-05-05T12:01:00.000Z",
    response: "I can see the screenshot.",
    attachments: [],
  };

  const merged = mergeHistoryItems([queued], [answered]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].status, "answered");
  assert.deepEqual(JSON.parse(JSON.stringify(merged[0].attachments)), [
    {
      id: "att-1",
      fileName: "screen.png",
      relativePath: "",
      path: "",
      size: 4,
      mimeType: "image/png",
      kind: "image",
    },
  ]);
});

test("web history merge preserves Direct schedule metadata", async () => {
  const { mergeHistoryItems } = await loadHistoryMergeHelpers();
  const merged = mergeHistoryItems([], [
    {
      requestId: "direct-1",
      projectPath: "/repo/clawdad",
      sessionId: "session-a",
      provider: "codex",
      message: "Fold this into the current pass.",
      sentAt: "2026-05-05T12:00:00.000Z",
      answeredAt: "2026-05-05T12:00:01.000Z",
      status: "answered",
      scheduleMode: "direct",
      response: "Sent directly into the active Codex turn.",
    },
  ]);

  assert.equal(merged[0].scheduleMode, "direct");
});

test("web history merge orders answered cards by response activity time", async () => {
  const { mergeHistoryItems } = await loadHistoryMergeHelpers();
  const olderPromptWithLaterAnswer = {
    requestId: "request-later-answer",
    projectPath: "/repo/clawdad",
    sessionId: "session-a",
    provider: "codex",
    message: "First prompt.",
    sentAt: "2026-05-06T12:00:00.000Z",
    answeredAt: "2026-05-06T12:05:00.000Z",
    status: "answered",
    response: "Later answer.",
  };
  const newerPromptWithEarlierAnswer = {
    requestId: "request-earlier-answer",
    projectPath: "/repo/clawdad",
    sessionId: "session-a",
    provider: "codex",
    message: "Second prompt.",
    sentAt: "2026-05-06T12:01:00.000Z",
    answeredAt: "2026-05-06T12:02:00.000Z",
    status: "answered",
    response: "Earlier answer.",
  };

  const merged = mergeHistoryItems([], [olderPromptWithLaterAnswer, newerPromptWithEarlierAnswer]);

  assert.deepEqual(JSON.parse(JSON.stringify(merged.map((entry) => entry.requestId))), [
    "request-earlier-answer",
    "request-later-answer",
  ]);
});

test("web history merge keeps newly returned local queued cards unread", async () => {
  const { mergeHistoryItems } = await loadHistoryMergeHelpers();
  const queued = {
    id: "local-pending",
    requestId: "request-unread",
    projectPath: "/repo/clawdad",
    sessionId: "session-a",
    provider: "codex",
    message: "Run the check.",
    sentAt: "2026-05-06T12:00:00.000Z",
    answeredAt: null,
    status: "queued",
    response: "",
    seenAt: null,
  };
  const answeredHistory = {
    requestId: "request-unread",
    projectPath: "/repo/clawdad",
    sessionId: "session-a",
    provider: "codex",
    message: "Run the check.",
    sentAt: "2026-05-06T12:00:00.000Z",
    answeredAt: "2026-05-06T12:01:00.000Z",
    status: "answered",
    response: "Done.",
  };

  const merged = mergeHistoryItems([queued], [answeredHistory]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].status, "answered");
  assert.equal(merged[0].response, "Done.");
  assert.equal(merged[0].seenAt, null);
});

test("web history merge treats a returned queued card as unread even after pending detail was opened", async () => {
  const { mergeHistoryItems } = await loadHistoryMergeHelpers();
  const queued = {
    id: "local-pending-seen",
    requestId: "request-pending-seen",
    projectPath: "/repo/clawdad",
    sessionId: "session-a",
    provider: "codex",
    message: "Run the next check.",
    sentAt: "2026-05-06T12:00:00.000Z",
    answeredAt: null,
    status: "queued",
    response: "",
    seenAt: "2026-05-06T12:00:15.000Z",
  };
  const answeredHistory = {
    requestId: "request-pending-seen",
    projectPath: "/repo/clawdad",
    sessionId: "session-a",
    provider: "codex",
    message: "Run the next check.",
    sentAt: "2026-05-06T12:00:00.000Z",
    answeredAt: "2026-05-06T12:01:00.000Z",
    status: "answered",
    response: "Still done.",
  };

  const merged = mergeHistoryItems([queued], [answeredHistory]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].status, "answered");
  assert.equal(merged[0].response, "Still done.");
  assert.equal(merged[0].seenAt, null);
});

test("web detail marks explicit queue-mode messages as queued and not sent yet", async () => {
  const [source, css] = await Promise.all([
    readFile(webAppPath, "utf8"),
    readFile(path.join(repoRoot, "web", "app.css"), "utf8"),
  ]);
  const { historyEntryQueuedForLater } = await loadThreadCacheHelpers();
  const active = {
    requestId: "active-request",
    projectPath: "/repo/clawdad",
    sessionId: "session-a",
    provider: "codex",
    message: "Current prompt.",
    sentAt: "2026-05-05T12:00:00.000Z",
    answeredAt: null,
    status: "queued",
    scheduleMode: "linear",
    response: "",
  };
  const waiting = {
    requestId: "waiting-request",
    projectPath: "/repo/clawdad",
    sessionId: "session-a",
    provider: "codex",
    message: "Run this next.",
    sentAt: "2026-05-05T12:01:00.000Z",
    answeredAt: null,
    status: "queued",
    scheduleMode: "queue",
    response: "",
  };
  const soloWaiting = {
    ...waiting,
    requestId: "solo-request",
    sentAt: "2026-05-05T12:02:00.000Z",
  };

  assert.equal(historyEntryQueuedForLater(active, [active, waiting]), false);
  assert.equal(historyEntryQueuedForLater(waiting, [active, waiting]), true);
  assert.equal(historyEntryQueuedForLater(soloWaiting, [soloWaiting]), true);
  assert.match(source, /function pendingThreadEntryLabel/u);
  assert.match(source, /handoffPending/u);
  assert.match(source, /return "Starting"/u);
  assert.match(source, /Queued", "not sent yet"/u);
  assert.match(source, /if \(queuedForLater\) \{\s*return group;\s*\}/u);
  assert.match(source, /normalizeHistoryScheduleMode\(payload\.effectiveDispatchMode \|\| payload\.dispatchMode \|\| payload\.scheduleMode\)/u);
  assert.match(css, /\.thread-card\.outbound\.queued-pending/u);
});

test("web history merge folds synthetic attachment transcript placeholders into concrete answers", async () => {
  const { mergeHistoryItems } = await loadHistoryMergeHelpers();
  const concrete = {
    requestId: "6119516a-afac-4032-9b9e-67c297e40995",
    projectPath: "/repo/frg-site",
    sessionId: "019df926-0f39-7c80-9d4f-ee13ef27036e",
    provider: "codex",
    message: "Do you see the image I am attaching to this message?",
    sentAt: "2026-05-05T19:12:08.000Z",
    answeredAt: "2026-05-05T19:19:16.000Z",
    status: "answered",
    exitCode: 0,
    response: "The image-backed check completed.",
  };
  const syntheticQueued = {
    requestId: "codex:019df926-0f39-7c80-9d4f-ee13ef27036e:3",
    projectPath: concrete.projectPath,
    sessionId: concrete.sessionId,
    provider: "codex",
    message: `${concrete.message}

[Clawdad attachment handoff:
- IMG_4315.png (image/png, 5914806 bytes): /repo/frg-site/.clawdad/attachments/upload/IMG_4315.png
Images are also attached to Codex directly when supported. For non-image files, use the local file paths above.]

<image name=[Image #1]>

</image>`,
    sentAt: "2026-05-05T19:12:17.968Z",
    answeredAt: null,
    status: "queued",
    response: "",
  };

  const merged = mergeHistoryItems([concrete], [syntheticQueued]);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].requestId, concrete.requestId);
  assert.equal(merged[0].status, "answered");
  assert.equal(merged[0].response, concrete.response);
  assert.equal(merged[0].answeredAt, concrete.answeredAt);
});

test("web artifacts surface through contextual Dumpy handoff instead of a global files tab", async () => {
  const [source, html] = await Promise.all([
    readFile(webAppPath, "utf8"),
    readFile(webIndexPath, "utf8"),
  ]);
  assert.match(source, /const artifactRefreshFreshMs = 60 \* 1000;/u);
  assert.doesNotMatch(html, /id="filesWorkspaceTab"/u);
  assert.doesNotMatch(html, /id="filesWorkspacePane"/u);
  assert.match(html, />Dumpy party</u);
  assert.match(html, />Open Dumpy</u);

  const artifactTargetsStart = source.indexOf("function artifactProjectsNeedingRefresh");
  const refreshArtifactsStart = source.indexOf("async function refreshArtifacts", artifactTargetsStart);
  assert.notEqual(artifactTargetsStart, -1);
  assert.notEqual(refreshArtifactsStart, -1);
  assert.ok(refreshArtifactsStart > artifactTargetsStart);

  const artifactTargets = source.slice(artifactTargetsStart, refreshArtifactsStart);
  assert.match(artifactTargets, /state\.selectedProject/u);
  assert.match(artifactTargets, /state\.artifactModalProject/u);
  assert.doesNotMatch(artifactTargets, /state\.workspaceMode === "files"/u);
  assert.doesNotMatch(artifactTargets, /state\.delegateModalProject/u);
  assert.doesNotMatch(artifactTargets, /threadEntryStatus/u);
  assert.doesNotMatch(artifactTargets, /threadEntryVisibleInQueue/u);

  const renderShelfStart = source.indexOf("function renderArtifactShelf");
  const projectLabelStart = source.indexOf("function projectLabelForPath", renderShelfStart);
  assert.notEqual(renderShelfStart, -1);
  assert.notEqual(projectLabelStart, -1);
  const renderShelf = source.slice(renderShelfStart, projectLabelStart);
  assert.match(renderShelf, /normalizeDumpyHandoff\(artifactState\.dumpy\)/u);
  assert.match(renderShelf, /const visible = Boolean\(dumpy && \(itemCount > 0 \|\| dumpy\.lastError\)\);/u);
  assert.match(renderShelf, /elements\.artifactShelf\.hidden = !visible;/u);
  assert.match(renderShelf, /buildDumpyHandoffCard\(dumpy\)/u);

  const loadArtifactsStart = source.indexOf("async function loadProjectArtifacts");
  const openArtifactsStart = source.indexOf("async function openArtifactsModal", loadArtifactsStart);
  assert.notEqual(loadArtifactsStart, -1);
  assert.notEqual(openArtifactsStart, -1);
  const loadArtifacts = source.slice(loadArtifactsStart, openArtifactsStart);
  assert.match(loadArtifacts, /Date\.now\(\) - Number\(existing\.loadedAt \|\| 0\) < artifactRefreshFreshMs/u);
  assert.match(loadArtifacts, /loadedAt: Date\.now\(\)/u);
  assert.match(loadArtifacts, /dumpy: normalizeDumpyHandoff\(payload\.dumpy\)/u);
});

test("web history merge replaces stale cached synthetic answer with fresh synthetic final answer", async () => {
  const { mergeHistoryItems } = await loadHistoryMergeHelpers();
  const staleCached = {
    requestId: "codex:019ddf17-7e93-7840-a89b-cc2702c32a02:54",
    projectPath: "/repo/clawdad",
    sessionId: "019ddf17-7e93-7840-a89b-cc2702c32a02",
    provider: "codex",
    message: "Please compare OpenClaw and Clawdad.",
    sentAt: "2026-05-03T15:35:13.537Z",
    answeredAt: "2026-05-03T15:35:16.000Z",
    status: "answered",
    exitCode: 0,
    response: "I will verify public docs first.",
  };
  const freshSyntheticFinal = {
    ...staleCached,
    answeredAt: "2026-05-03T15:40:14.000Z",
    response: "Detailed final comparison.",
  };

  const merged = mergeHistoryItems([staleCached], [freshSyntheticFinal]);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].requestId, freshSyntheticFinal.requestId);
  assert.equal(merged[0].status, "answered");
  assert.equal(merged[0].response, freshSyntheticFinal.response);
  assert.equal(merged[0].answeredAt, freshSyntheticFinal.answeredAt);
});

test("web history merge prefers concrete answered request over synthetic transcript answer", async () => {
  const { mergeHistoryItems } = await loadHistoryMergeHelpers();
  const synthetic = {
    requestId: "codex:019ddf17-7e93-7840-a89b-cc2702c32a02:54",
    projectPath: "/repo/clawdad",
    sessionId: "019ddf17-7e93-7840-a89b-cc2702c32a02",
    provider: "codex",
    message: "Please compare OpenClaw and Clawdad.",
    sentAt: "2026-05-03T15:35:13.537Z",
    answeredAt: "2026-05-03T15:35:16.000Z",
    status: "answered",
    exitCode: 0,
    response: "I will verify public docs first.",
  };
  const concrete = {
    ...synthetic,
    requestId: "2f66a266-6b05-441f-8e80-32d2e15224fd",
    answeredAt: "2026-05-03T15:40:14.000Z",
    response: "Detailed final comparison.",
  };

  const merged = mergeHistoryItems([synthetic], [concrete]);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].requestId, concrete.requestId);
  assert.equal(merged[0].status, "answered");
  assert.equal(merged[0].response, concrete.response);
  assert.equal(merged[0].answeredAt, concrete.answeredAt);
});

test("web history merge lets a real transcript answer replace a cached failed card", async () => {
  const { mergeHistoryItems } = await loadHistoryMergeHelpers();
  const cachedFailed = {
    requestId: "2f66a266-6b05-441f-8e80-32d2e15224fd",
    projectPath: "/repo/clawdad",
    sessionId: "019ddf17-7e93-7840-a89b-cc2702c32a02",
    provider: "codex",
    message: "Please compare OpenClaw and Clawdad.",
    sentAt: "2026-05-03T15:35:13.537Z",
    answeredAt: "2026-05-03T15:37:16.000Z",
    status: "failed",
    exitCode: 1,
    response: "Failed.",
  };
  const transcriptAnswer = {
    requestId: "codex:019ddf17-7e93-7840-a89b-cc2702c32a02:54",
    projectPath: "/repo/clawdad",
    sessionId: cachedFailed.sessionId,
    provider: "codex",
    message: cachedFailed.message,
    sentAt: "2026-05-03T15:35:18.000Z",
    answeredAt: "2026-05-03T15:37:20.000Z",
    status: "answered",
    exitCode: 0,
    response: "Detailed final comparison.",
  };

  const merged = mergeHistoryItems([cachedFailed], [transcriptAnswer]);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].status, "answered");
  assert.equal(merged[0].response, transcriptAnswer.response);
  assert.equal(merged[0].answeredAt, transcriptAnswer.answeredAt);
});
