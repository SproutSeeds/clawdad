const state = {
  projects: [],
  recentThreads: [],
  projectRoots: [],
  workspace: null,
  workspaceSetupPending: false,
  workspaceSetupStatus: "",
  workspaceSetupDraft: "",
  settingsModalOpen: false,
  settingsWorkspaceFocusDraft: "",
  settingsWorkspaceRootDrafts: [],
  settingsWorkspaceNewRootDraft: "",
  settingsWorkspaceStatus: "",
  settingsWorkspacePending: false,
  cloudPairingPending: false,
  cloudPairingStatus: "",
  cloudPairingQrSvg: "",
  cloudPairingCode: "",
  cloudPairingExpiresAt: "",
  cloudDevices: [],
  cloudDevicesPending: false,
  cloudDevicesStatus: "",
  directoryPickerPending: "",
  directoryBrowserOpen: false,
  directoryBrowserPurpose: "",
  directoryBrowserPath: "",
  directoryBrowserPathDraft: "",
  directoryBrowserParent: "",
  directoryBrowserEntries: [],
  directoryBrowserRoots: [],
  directoryBrowserQuery: "",
  directoryBrowserLoading: false,
  directoryBrowserStatus: "",
  selectedProject: "",
  selectedSessionId: "",
  threadScope: "project",
  threadPreviewError: "",
  projectPickerOpen: false,
  projectPickerQuery: "",
  workspaceMode: "project",
  sessionImportModalProject: "",
  sessionImportPendingId: "",
  sessionTitleModalProject: "",
  sessionTitleModalSessionId: "",
  sessionTitleDraft: "",
  sessionTitleConfirmRemove: false,
  sessionTitlePending: false,
  sessionCreatePending: false,
  sessionTitleError: "",
  pendingSessionRenames: {},
  importableSessionsByProject: {},
  threadEntries: [],
  modalThread: null,
  summaryModalProject: "",
  projectSummaries: {},
  codexIntegrationModalProject: "",
  codexIntegrationByProject: {},
  codexIntegrationPending: false,
  artifactModalProject: "",
  artifactsByProject: {},
  artifactDownloadPendingId: "",
  terminalLaunchPendingKey: "",
  terminalPanel: {
    projectPath: "",
    sessionId: "",
    requestId: "",
    projectLabel: "",
    sessionLabel: "",
    events: [],
    nextCursor: "0",
    total: 0,
    loading: false,
    initialized: false,
    error: "",
    requestStatus: null,
  },
  artifactRefreshPromises: {},
  artifactShelfCollapsed: false,
  activeRunsModalOpen: false,
  delegateModalProject: "",
  delegateModalLane: "default",
  delegatesByProject: {},
  delegateSelectedRunIds: {},
  delegateLogModes: {},
  delegateCarouselSlide: "progress",
  delegateBriefDraft: "",
  delegateBriefDirty: false,
  delegateBriefPending: false,
  delegatePlanPending: false,
  delegateRunPending: false,
  delegateSupervisorPending: false,
  delegateRunSummaryPending: false,
  delegateFeedPending: false,
  projectModalOpen: false,
  projectModalMode: "existing",
  projectModalRoot: "",
  projectModalRepoPath: "",
  projectModalName: "",
  projectModalProvider: "codex",
  projectModalStatus: "",
  projectModalReturnToPicker: false,
  historyThreads: {},
  queueCollapsed: false,
  copiedFeedback: {},
  projectsLoading: true,
  projectRootsLoading: false,
  dispatchPending: false,
  dispatchMode: "direct",
  accessMode: "repo",
  sessionSwitchPending: false,
  projectModalPending: false,
  projectsRefreshPromise: null,
  projectAutoImportRefreshTimer: null,
  projectRootsRefreshPromise: null,
  threadRefreshPromise: null,
  recentHistoryRefreshPromise: null,
  recentHistoryLoadedAt: 0,
  summaryRefreshPromise: null,
  delegateRefreshPromise: null,
  historyPrefetchPromises: {},
  foregroundRefreshPromise: null,
  lastForegroundRefreshAt: 0,
  controlLockTarget: "",
  controlLockUntil: 0,
  audioPlayback: {
    key: "",
    status: "idle",
  },
  audioAvailability: {},
  ttsStatus: {
    loaded: false,
    enabled: true,
    available: true,
    error: "",
    errorCode: "",
    retryAfterMs: 0,
    unavailableUntil: null,
  },
  quickPrompts: [],
  quickPromptsLoaded: false,
  quickPromptsLoading: false,
  quickPromptsSaving: false,
  composerToolsOpen: false,
  quickPromptModalOpen: false,
  quickPromptDraftMode: "",
  quickPromptDraftId: "",
  quickPromptDraftTitle: "",
  quickPromptDraftText: "",
  quickPromptResetConfirm: false,
  quickPromptError: "",
  composerAttachments: [],
  composerCutPending: false,
  voiceRecorder: null,
  voiceStream: null,
  voiceChunks: [],
  voiceState: "idle",
  voiceError: "",
  voiceInputDeviceId: "",
  voiceInputDevices: [],
  voiceInputDevicesLoading: false,
  voiceSettingsStatus: "",
  voiceActiveInputLabel: "",
  desktopAppStatus: null,
  desktopAppPending: "",
  desktopAppMessage: "",
  systemReadiness: null,
  systemSetupStep: 0,
  systemSetupForcedOpen: false,
  systemSetupPending: "",
  systemSetupStatus: "",
  systemSetupWorkspaceDraft: "",
  systemSetupPollTimer: null,
  subscriptionEntitlement: null,
  subscriptionEntitlementStatus: "",
  remoteAssistStatus: null,
  remoteAssistPending: false,
  remoteAssistInfoOpen: false,
  remoteComputers: [],
  remoteComputersPending: false,
  remoteComputersStatus: "",
  remotePairingOpen: false,
  remotePairingCode: "",
  queueArchiveConfirmEntryId: "",
};

const elements = {
  headerCarouselButton: document.querySelector("#headerCarouselButton"),
  headerCarouselImage: document.querySelector("#headerCarouselImage"),
  headerCatchphrase: document.querySelector("#headerCatchphrase"),
  projectWorkspaceTab: document.querySelector("#projectWorkspaceTab"),
  autoWorkspaceTab: document.querySelector("#autoWorkspaceTab"),
  summaryWorkspaceTab: document.querySelector("#summaryWorkspaceTab"),
  projectWorkspacePane: document.querySelector("#projectWorkspacePane"),
  autoWorkspacePane: document.querySelector("#autoWorkspacePane"),
  selectedProjectDelegateMeta: document.querySelector("#selectedProjectDelegateMeta"),
  selectedProjectDelegateState: document.querySelector("#selectedProjectDelegateState"),
  selectedProjectDelegateList: document.querySelector("#selectedProjectDelegateList"),
  activeRunsInlineMeta: document.querySelector("#activeRunsInlineMeta"),
  activeRunsInlineState: document.querySelector("#activeRunsInlineState"),
  activeRunsInlineList: document.querySelector("#activeRunsInlineList"),
  projectSelect: document.querySelector("#projectSelect"),
  projectPickerButton: document.querySelector("#projectPickerButton"),
  projectPickerButtonTitle: document.querySelector("#projectPickerButtonTitle"),
  projectPickerButtonSubtitle: document.querySelector("#projectPickerButtonSubtitle"),
  projectAddButton: document.querySelector("#projectAddButton"),
  workspaceSetupPanel: document.querySelector("#workspaceSetupPanel"),
  workspaceSetupForm: document.querySelector("#workspaceSetupForm"),
  workspaceRootInput: document.querySelector("#workspaceRootInput"),
  workspaceRootChooseButton: document.querySelector("#workspaceRootChooseButton"),
  workspaceSetupSaveButton: document.querySelector("#workspaceSetupSaveButton"),
  workspaceSetupState: document.querySelector("#workspaceSetupState"),
  settingsButton: document.querySelector("#settingsButton"),
  settingsModal: document.querySelector("#settingsModal"),
  settingsBackdrop: document.querySelector("#settingsBackdrop"),
  settingsClose: document.querySelector("#settingsClose"),
  settingsForm: document.querySelector("#settingsForm"),
  settingsState: document.querySelector("#settingsState"),
  settingsScratchpadInput: document.querySelector("#settingsScratchpadInput"),
  settingsScratchpadChooseButton: document.querySelector("#settingsScratchpadChooseButton"),
  settingsProjectRootsList: document.querySelector("#settingsProjectRootsList"),
  settingsNewRootInput: document.querySelector("#settingsNewRootInput"),
  settingsChooseRootButton: document.querySelector("#settingsChooseRootButton"),
  settingsAddRootButton: document.querySelector("#settingsAddRootButton"),
  settingsVoiceInputSelect: document.querySelector("#settingsVoiceInputSelect"),
  settingsRefreshVoiceDevicesButton: document.querySelector("#settingsRefreshVoiceDevicesButton"),
  settingsVoiceStatus: document.querySelector("#settingsVoiceStatus"),
  settingsDesktopAppSection: document.querySelector("#settingsDesktopAppSection"),
  settingsDesktopAppVersion: document.querySelector("#settingsDesktopAppVersion"),
  settingsDesktopAppStatus: document.querySelector("#settingsDesktopAppStatus"),
  settingsSubscriptionStatus: document.querySelector("#settingsSubscriptionStatus"),
  settingsOpenSetupButton: document.querySelector("#settingsOpenSetupButton"),
  settingsCheckUpdatesButton: document.querySelector("#settingsCheckUpdatesButton"),
  settingsOpenLogsButton: document.querySelector("#settingsOpenLogsButton"),
  settingsCopyDiagnosticsButton: document.querySelector("#settingsCopyDiagnosticsButton"),
  settingsRemoteAssistSection: document.querySelector("#settingsRemoteAssistSection"),
  settingsRemoteAssistToggle: document.querySelector("#settingsRemoteAssistToggle"),
  settingsRemoteAssistStatus: document.querySelector("#settingsRemoteAssistStatus"),
  settingsRemoteAssistSubhead: document.querySelector("#settingsRemoteAssistSubhead"),
  settingsRemoteAssistInfoButton: document.querySelector("#settingsRemoteAssistInfoButton"),
  settingsRemoteAssistInfo: document.querySelector("#settingsRemoteAssistInfo"),
  settingsRemoteAssistMacHelp: document.querySelector("#settingsRemoteAssistMacHelp"),
  settingsRemoteAssistWindowsHelp: document.querySelector("#settingsRemoteAssistWindowsHelp"),
  settingsRemoteAssistPermissionGrid: document.querySelector("#settingsRemoteAssistPermissionGrid"),
  settingsRemoteAssistScreenButton: document.querySelector("#settingsRemoteAssistScreenButton"),
  settingsRemoteAssistScreenState: document.querySelector("#settingsRemoteAssistScreenState"),
  settingsRemoteAssistControlButton: document.querySelector("#settingsRemoteAssistControlButton"),
  settingsRemoteAssistControlState: document.querySelector("#settingsRemoteAssistControlState"),
  settingsRemoteAssistStopButton: document.querySelector("#settingsRemoteAssistStopButton"),
  settingsPairIphoneButton: document.querySelector("#settingsPairIphoneButton"),
  settingsPairingQr: document.querySelector("#settingsPairingQr"),
  settingsPairingStatus: document.querySelector("#settingsPairingStatus"),
  settingsPairingExpiry: document.querySelector("#settingsPairingExpiry"),
  settingsCopyPairingCodeButton: document.querySelector("#settingsCopyPairingCodeButton"),
  settingsRefreshDevicesButton: document.querySelector("#settingsRefreshDevicesButton"),
  settingsPairedDevices: document.querySelector("#settingsPairedDevices"),
  settingsRemoteComputersSection: document.querySelector("#settingsRemoteComputersSection"),
  settingsPairRemoteComputerButton: document.querySelector("#settingsPairRemoteComputerButton"),
  settingsRemotePairingForm: document.querySelector("#settingsRemotePairingForm"),
  settingsRemotePairingCode: document.querySelector("#settingsRemotePairingCode"),
  settingsRemotePairingCancel: document.querySelector("#settingsRemotePairingCancel"),
  settingsRemotePairingSubmit: document.querySelector("#settingsRemotePairingSubmit"),
  settingsRemoteComputersStatus: document.querySelector("#settingsRemoteComputersStatus"),
  settingsRemoteComputersList: document.querySelector("#settingsRemoteComputersList"),
  settingsCancelButton: document.querySelector("#settingsCancelButton"),
  settingsSaveButton: document.querySelector("#settingsSaveButton"),
  systemSetupModal: document.querySelector("#systemSetupModal"),
  systemSetupBackButton: document.querySelector("#systemSetupBackButton"),
  systemSetupProgress: document.querySelector("#systemSetupProgress"),
  systemSetupRoleStep: document.querySelector("#systemSetupRoleStep"),
  systemSetupRuntimeStep: document.querySelector("#systemSetupRuntimeStep"),
  systemSetupWorkspaceStep: document.querySelector("#systemSetupWorkspaceStep"),
  systemSetupFinishStep: document.querySelector("#systemSetupFinishStep"),
  systemSetupRoleButtons: [...document.querySelectorAll("[data-system-role]")],
  systemSetupNodeDetail: document.querySelector("#systemSetupNodeDetail"),
  systemSetupNodeState: document.querySelector("#systemSetupNodeState"),
  systemSetupOrpDetail: document.querySelector("#systemSetupOrpDetail"),
  systemSetupOrpState: document.querySelector("#systemSetupOrpState"),
  systemSetupCodexRow: document.querySelector("#systemSetupCodexRow"),
  systemSetupCodexDetail: document.querySelector("#systemSetupCodexDetail"),
  systemSetupCodexState: document.querySelector("#systemSetupCodexState"),
  systemSetupCodexActions: document.querySelector("#systemSetupCodexActions"),
  systemSetupInstallCodexButton: document.querySelector("#systemSetupInstallCodexButton"),
  systemSetupLoginCodexButton: document.querySelector("#systemSetupLoginCodexButton"),
  systemSetupRefreshButton: document.querySelector("#systemSetupRefreshButton"),
  systemSetupRuntimeStatus: document.querySelector("#systemSetupRuntimeStatus"),
  systemSetupWorkspaceText: document.querySelector("#systemSetupWorkspaceText"),
  systemSetupWorkspaceInput: document.querySelector("#systemSetupWorkspaceInput"),
  systemSetupWorkspaceChooseButton: document.querySelector("#systemSetupWorkspaceChooseButton"),
  systemSetupWorkspaceStatus: document.querySelector("#systemSetupWorkspaceStatus"),
  systemSetupFinishText: document.querySelector("#systemSetupFinishText"),
  systemSetupFooterStatus: document.querySelector("#systemSetupFooterStatus"),
  systemSetupNextButton: document.querySelector("#systemSetupNextButton"),
  directoryBrowserModal: document.querySelector("#directoryBrowserModal"),
  directoryBrowserBackdrop: document.querySelector("#directoryBrowserBackdrop"),
  directoryBrowserClose: document.querySelector("#directoryBrowserClose"),
  directoryBrowserTitle: document.querySelector("#directoryBrowserTitle"),
  directoryBrowserState: document.querySelector("#directoryBrowserState"),
  directoryBrowserRoots: document.querySelector("#directoryBrowserRoots"),
  directoryBrowserUpButton: document.querySelector("#directoryBrowserUpButton"),
  directoryBrowserPathInput: document.querySelector("#directoryBrowserPathInput"),
  directoryBrowserGoButton: document.querySelector("#directoryBrowserGoButton"),
  directoryBrowserSearchInput: document.querySelector("#directoryBrowserSearchInput"),
  directoryBrowserList: document.querySelector("#directoryBrowserList"),
  directoryBrowserCancelButton: document.querySelector("#directoryBrowserCancelButton"),
  directoryBrowserUseButton: document.querySelector("#directoryBrowserUseButton"),
  projectDelegateButton: document.querySelector("#projectDelegateButton"),
  sessionControl: document.querySelector(".session-control"),
  sessionSelect: document.querySelector("#sessionSelect"),
  sessionAddButton: document.querySelector("#sessionAddButton"),
  sessionImportButton: document.querySelector("#sessionImportButton"),
  sessionImportOrb: document.querySelector("#sessionImportOrb"),
  sessionThreadButton: document.querySelector("#sessionThreadButton"),
  messageInput: document.querySelector("#messageInput"),
  messageCutButton: document.querySelector("#messageCutButton"),
  messageCopyButton: document.querySelector("#messageCopyButton"),
  composerClipboardStatus: document.querySelector("#composerClipboardStatus"),
  composerToolsButton: document.querySelector("#composerToolsButton"),
  composerToolsMenu: document.querySelector("#composerToolsMenu"),
  composerVoiceButton: document.querySelector("#composerVoiceButton"),
  composerVoiceCaptureInput: document.querySelector("#composerVoiceCaptureInput"),
  composerAttachmentButton: document.querySelector("#composerAttachmentButton"),
  composerAttachmentInput: document.querySelector("#composerAttachmentInput"),
  composerAttachmentList: document.querySelector("#composerAttachmentList"),
  quickPromptButton: document.querySelector("#quickPromptButton"),
  currentTerminalButton: document.querySelector("#currentTerminalButton"),
  composerAccessSelect: document.querySelector("#composerAccessSelect"),
  terminalPanel: document.querySelector("#terminalPanel"),
  terminalPanelBack: document.querySelector("#terminalPanelBack"),
  terminalPanelTitle: document.querySelector("#terminalPanelTitle"),
  terminalPanelStatus: document.querySelector("#terminalPanelStatus"),
  terminalPanelMeta: document.querySelector("#terminalPanelMeta"),
  terminalStreamState: document.querySelector("#terminalStreamState"),
  terminalStreamList: document.querySelector("#terminalStreamList"),
  terminalPanelOpenExternal: document.querySelector("#terminalPanelOpenExternal"),
  dispatchModeButtons: Array.from(document.querySelectorAll("[data-dispatch-mode]")),
  dispatchForm: document.querySelector("#dispatchForm"),
  dispatchButton: document.querySelector("#dispatchButton"),
  quickPromptModal: document.querySelector("#quickPromptModal"),
  quickPromptBackdrop: document.querySelector("#quickPromptBackdrop"),
  quickPromptClose: document.querySelector("#quickPromptClose"),
  quickPromptSubtitle: document.querySelector("#quickPromptSubtitle"),
  quickPromptState: document.querySelector("#quickPromptState"),
  quickPromptList: document.querySelector("#quickPromptList"),
  quickPromptNewButton: document.querySelector("#quickPromptNewButton"),
  quickPromptResetButton: document.querySelector("#quickPromptResetButton"),
  quickPromptForm: document.querySelector("#quickPromptForm"),
  quickPromptTitleInput: document.querySelector("#quickPromptTitleInput"),
  quickPromptTextInput: document.querySelector("#quickPromptTextInput"),
  quickPromptDeleteButton: document.querySelector("#quickPromptDeleteButton"),
  quickPromptCancelButton: document.querySelector("#quickPromptCancelButton"),
  quickPromptSaveButton: document.querySelector("#quickPromptSaveButton"),
  mailboxState: document.querySelector("#mailboxState"),
  queueUnreadOrb: document.querySelector("#queueUnreadOrb"),
  queueSection: document.querySelector(".queue"),
  queueToggle: document.querySelector("#queueToggle"),
  queueBody: document.querySelector("#queueBody"),
  queueList: document.querySelector("#queueList"),
  queueArchiveModal: document.querySelector("#queueArchiveModal"),
  queueArchiveBackdrop: document.querySelector("#queueArchiveBackdrop"),
  queueArchiveClose: document.querySelector("#queueArchiveClose"),
  queueArchiveMeta: document.querySelector("#queueArchiveMeta"),
  queueArchiveMessage: document.querySelector("#queueArchiveMessage"),
  queueArchiveCancelButton: document.querySelector("#queueArchiveCancelButton"),
  queueArchiveConfirmButton: document.querySelector("#queueArchiveConfirmButton"),
  detailModal: document.querySelector("#detailModal"),
  detailBackdrop: document.querySelector("#detailBackdrop"),
  detailClose: document.querySelector("#detailClose"),
  detailProject: document.querySelector("#detailProject"),
  detailSession: document.querySelector("#detailSession"),
  detailHistoryState: document.querySelector("#detailHistoryState"),
  detailHistoryList: document.querySelector("#detailHistoryList"),
  detailScrollBottomButton: document.querySelector("#detailScrollBottomButton"),
  threadPreviewPanel: document.querySelector("#threadPreviewPanel"),
  threadPreviewSubtitle: document.querySelector("#threadPreviewSubtitle"),
  threadPreviewRefreshButton: document.querySelector("#threadPreviewRefreshButton"),
  threadScopeProjectButton: document.querySelector("#threadScopeProjectButton"),
  threadScopeAllButton: document.querySelector("#threadScopeAllButton"),
  threadPreviewState: document.querySelector("#threadPreviewState"),
  threadPreviewList: document.querySelector("#threadPreviewList"),
  projectSummaryButton: document.querySelector("#projectSummaryButton"),
  projectCodexButton: document.querySelector("#projectCodexButton"),
  codexIntegrationModal: document.querySelector("#codexIntegrationModal"),
  codexIntegrationBackdrop: document.querySelector("#codexIntegrationBackdrop"),
  codexIntegrationClose: document.querySelector("#codexIntegrationClose"),
  codexIntegrationProject: document.querySelector("#codexIntegrationProject"),
  codexIntegrationStatus: document.querySelector("#codexIntegrationStatus"),
  codexIntegrationState: document.querySelector("#codexIntegrationState"),
  codexIntegrationList: document.querySelector("#codexIntegrationList"),
  codexIntegrationRefreshButton: document.querySelector("#codexIntegrationRefreshButton"),
  codexIntegrationInstallButton: document.querySelector("#codexIntegrationInstallButton"),
  activeRunsButton: document.querySelector("#activeRunsButton"),
  activeRunsOrb: document.querySelector("#activeRunsOrb"),
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
  projectModalTitle: document.querySelector("#projectModalTitle"),
  projectModalDescription: document.querySelector("#projectModalDescription"),
  projectDestination: document.querySelector("#projectDestination"),
  projectDestinationValue: document.querySelector("#projectDestinationValue"),
  projectRootSelect: document.querySelector("#projectRootSelect"),
  projectRepoSelect: document.querySelector("#projectRepoSelect"),
  projectNameInput: document.querySelector("#projectNameInput"),
  projectProviderSelect: document.querySelector("#projectProviderSelect"),
  projectCreateButton: document.querySelector("#projectCreateButton"),
  projectModeExisting: document.querySelector("#projectModeExisting"),
  projectModeNew: document.querySelector("#projectModeNew"),
  projectPickerModal: document.querySelector("#projectPickerModal"),
  projectPickerBackdrop: document.querySelector("#projectPickerBackdrop"),
  projectPickerClose: document.querySelector("#projectPickerClose"),
  projectPickerCount: document.querySelector("#projectPickerCount"),
  projectPickerAddExistingButton: document.querySelector("#projectPickerAddExistingButton"),
  projectPickerSearchInput: document.querySelector("#projectPickerSearchInput"),
  projectPickerList: document.querySelector("#projectPickerList"),
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
  activeRunsModal: document.querySelector("#activeRunsModal"),
  activeRunsBackdrop: document.querySelector("#activeRunsBackdrop"),
  activeRunsClose: document.querySelector("#activeRunsClose"),
  activeRunsMeta: document.querySelector("#activeRunsMeta"),
  activeRunsState: document.querySelector("#activeRunsState"),
  activeRunsList: document.querySelector("#activeRunsList"),
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
  delegateProgressPanel: document.querySelector("#delegateProgressPanel"),
  delegateRunsPanel: document.querySelector("#delegateRunsPanel"),
  delegateRunLogPanel: document.querySelector("#delegateRunLogPanel"),
  delegateSupervisorPanel: document.querySelector("#delegateSupervisorPanel"),
  delegateReviewPanel: document.querySelector("#delegateReviewPanel"),
  delegateBriefPanel: document.querySelector("#delegateBriefPanel"),
  delegatePlanPanel: document.querySelector("#delegatePlanPanel"),
  delegateSummaryPanel: document.querySelector("#delegateSummaryPanel"),
  delegateProgressList: document.querySelector("#delegateProgressList"),
  delegateDiagnosticsChecks: document.querySelector("#delegateDiagnosticsChecks"),
  delegateDebugList: document.querySelector("#delegateDebugList"),
  delegateRunCardList: document.querySelector("#delegateRunCardList"),
  delegateRunList: document.querySelector("#delegateRunList"),
  delegateSupervisorList: document.querySelector("#delegateSupervisorList"),
  delegateReviewList: document.querySelector("#delegateReviewList"),
  delegateSummaryList: document.querySelector("#delegateSummaryList"),
  delegatePlanList: document.querySelector("#delegatePlanList"),
};

const autoRefreshMs = 15000;
const foregroundRefreshDebounceMs = 1500;
const importableSessionsCacheMs = 30000;
const appBuildVersion = String(window.__CLAWDAD_APP_BUILD__ || "dev").replace(/[^A-Za-z0-9._-]/g, "_");
const cacheVersionSuffix = appBuildVersion && appBuildVersion !== "__CLAWDAD_APP_BUILD__"
  ? `-${appBuildVersion}`
  : "";
const projectCacheKey = `clawdad-project-catalog-v4${cacheVersionSuffix}`;
const threadCacheKey = "clawdad-thread-log-v2";
const threadScopeKey = "clawdad-thread-scope-v1";
const queueCollapsedKey = "clawdad-queue-collapsed-v1";
const artifactShelfCollapsedKey = "clawdad-artifact-shelf-collapsed-v1";
const composerCopyKey = "composer-message";
const composerCutKey = "composer-cut";
let queueArchiveReturnFocus = null;
let queueArchiveFocusPending = false;
let projectPickerReturnFocus = null;
let projectModalReturnFocus = null;
let sessionThreadReturnFocus = null;
let terminalPanelReturnFocus = null;
let terminalPanelHistoryActive = false;
let terminalPanelPollTimer = null;
let terminalPanelRequestSequence = 0;
let terminalPanelStickToBottom = true;
const quickPromptTitleMax = 80;
const quickPromptTextMax = 12_000;
const composerAccessModeKey = "clawdad-composer-access-mode-v1";
const voiceInputDeviceKey = "clawdad-voice-input-device-v1";
const newSessionSelectValue = "__clawdad_new_session__";
const dispatchModes = ["direct", "queue"];
const accessModes = ["repo", "full"];
const dispatchModeDetails = {
  direct: {
    label: "Direct",
    aria: "Dispatch mode: Direct",
    title: "Direct mode: send now or steer the active turn after its current tool call",
    icon: '<path d="M4 5.25h7.5M8.75 2.75 11.5 5.25 8.75 7.75M6.5 12.75H14M11.25 10.25 14 12.75l-2.75 2.5" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"></path>',
  },
  queue: {
    label: "Queue",
    aria: "Dispatch mode: Queue message",
    title: "Queue mode: send after the active turn finishes",
    icon: '<path d="M4.2 4.4h9.6M4.2 9h9.6M4.2 13.6h5.9M12.15 11.55l2.05 2.05-2.05 2.05" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"></path>',
  },
};
const queuedDispatchGraceMs = 15000;
// Dispatch startup can lag behind refreshes; do not mark optimistic queue cards failed too early.
const queuedDispatchAttachGraceMs = 2 * 60 * 1000;
const staleLocalPendingBlockMs = queuedDispatchAttachGraceMs;
const historyDuplicateWindowMs = queuedDispatchAttachGraceMs;
const copiedFeedbackMs = 1400;
const historyPageSize = 20;
const historyPrefetchFreshMs = 5 * 60 * 1000;
const historyPrefetchEntryLimit = 8;
const recentHistoryRefreshMs = 60 * 1000;
const recentHistoryLimit = 24;
const recentHistorySessionLimit = 10;
const recentHistoryPerSessionLimit = 4;
const terminalStreamPageSize = 120;
const terminalStreamPollMs = 2400;
const artifactRefreshFreshMs = 60 * 1000;
const threadEntryCacheLimit = 80;
const ttsInlineTextLimit = 50_000;
const audioLoadingSpinnerFrameMs = 680;
const headerCarouselIntervalMs = 11000;
const headerCarouselVersion = "20260406m";
const headerCatchphraseSwapMs = 150;
const featuredProjectRules = Object.freeze({});
const nativeBridgeTimeoutMs = 30_000;
const nativeBridge = (() => {
  const pending = new Map();
  const messageHandler = () => {
    const webKitHandler = window.webkit?.messageHandlers?.clawdadNative;
    if (webKitHandler?.postMessage) {
      return webKitHandler;
    }
    const webView = window.chrome?.webview;
    if (webView?.postMessage) {
      return {
        postMessage(payload) {
          webView.postMessage(payload);
        },
      };
    }
    return null;
  };
  const bridge = {
    isAvailable() {
      return Boolean(messageHandler());
    },
    call(method, params = {}) {
      const handler = messageHandler();
      if (!handler) {
        return Promise.reject(new Error("Native ClawDad bridge is unavailable"));
      }
      const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      return new Promise((resolve, reject) => {
        const timer = window.setTimeout(() => {
          pending.delete(id);
          reject(new Error("Native ClawDad bridge timed out"));
        }, nativeBridgeTimeoutMs);
        pending.set(id, { resolve, reject, timer });
        handler.postMessage({ id, method, params });
      });
    },
    getCapabilities() {
      return bridge.call("getCapabilities");
    },
    chooseFolder(params = {}) {
      return bridge.call("chooseFolder", params);
    },
    getSystemReadiness({ forceCodexUpdateCheck = false } = {}) {
      return bridge.call("getSystemReadiness", {
        forceCodexUpdateCheck: Boolean(forceCodexUpdateCheck),
      });
    },
    setComputerRole(role) {
      return bridge.call("setComputerRole", { role: String(role || "") });
    },
    installCodex() {
      return bridge.call("installCodex");
    },
    openCodexLogin() {
      return bridge.call("openCodexLogin");
    },
    completeSystemSetup() {
      return bridge.call("completeSystemSetup");
    },
    getRemoteAssistStatus() {
      return bridge.call("getRemoteAssistStatus");
    },
    setRemoteAssistEnabled(enabled) {
      return bridge.call("setRemoteAssistEnabled", { enabled: Boolean(enabled) });
    },
    requestRemoteAssistPermissions() {
      return bridge.call("requestRemoteAssistPermissions");
    },
    openRemoteAssistPrivacy(pane) {
      return bridge.call("openRemoteAssistPrivacy", { pane });
    },
    stopRemoteAssist() {
      return bridge.call("stopRemoteAssist");
    },
    getRemoteComputers() {
      return bridge.call("getRemoteComputers");
    },
    pairRemoteComputer(code) {
      return bridge.call("pairRemoteComputer", { code: String(code || "") });
    },
    openRemoteComputer(computerId) {
      return bridge.call("openRemoteComputer", { computerId: String(computerId || "") });
    },
    forgetRemoteComputer(computerId) {
      return bridge.call("forgetRemoteComputer", { computerId: String(computerId || "") });
    },
    getDesktopAppStatus() {
      return bridge.call("getDesktopAppStatus");
    },
    checkForUpdates() {
      return bridge.call("checkForUpdates");
    },
    openLogs() {
      return bridge.call("openLogs");
    },
    copyDiagnostics() {
      return bridge.call("copyDiagnostics");
    },
    __resolve(payload = {}) {
      const entry = pending.get(payload.id);
      if (!entry) {
        return;
      }
      window.clearTimeout(entry.timer);
      pending.delete(payload.id);
      if (payload.ok) {
        entry.resolve(payload.result || {});
      } else {
        entry.reject(new Error(payload.error || "Native ClawDad bridge failed"));
      }
    },
  };
  window.ClawDadNative = bridge;
  return bridge;
})();

window.chrome?.webview?.addEventListener?.("message", (event) => {
  const payload = event.data;
  if (!payload || typeof payload !== "object") {
    return;
  }
  if (payload.channel === "clawdad-native-response") {
    nativeBridge.__resolve(payload);
    return;
  }
  if (payload.channel === "clawdad-native-remote-assist-status") {
    window.dispatchEvent(new CustomEvent(
      "clawdad-native-remote-assist-status",
      { detail: payload.status || {} },
    ));
    return;
  }
  if (payload.channel === "clawdad-native-remote-computers-status") {
    window.dispatchEvent(new CustomEvent(
      "clawdad-native-remote-computers-status",
      { detail: payload.status || {} },
    ));
  }
});

window.addEventListener("clawdad-native-remote-assist-status", (event) => {
  state.remoteAssistStatus = event.detail && typeof event.detail === "object"
    ? event.detail
    : null;
  renderAll();
});

window.addEventListener("clawdad-native-remote-computers-status", (event) => {
  applyRemoteComputersStatus(event.detail);
  renderAll();
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
  { id: "progress", label: "Progress" },
  { id: "history", label: "History" },
  { id: "details", label: "Details" },
  { id: "brief", label: "Goal" },
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
let activeMessageAudio = null;
let audioNoticeTimer = null;
let audioLoadingSpinnerFrameRequest = 0;
let audioLoadingSpinnerFrameStartedAt = 0;
const audioPreparePromises = new Map();
const audioPrepareTimers = new Map();
const audioPreparePlaybackPromises = new Map();
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
const ttsPreparePollMs = 3500;
const ttsClickPreparePollMs = 700;
const ttsClickPrepareTimeoutMs = 45_000;
const audioPlaybackStartTimeoutMs = 3500;

function copyIconMarkup() {
  return `
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="5.25" y="3.25" width="7.5" height="9.5" rx="1.6" stroke="currentColor" stroke-width="1.3"></rect>
      <path d="M3.25 10.25V4.9c0-.91.74-1.65 1.65-1.65h4.35" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"></path>
    </svg>
  `;
}

function cutIconMarkup() {
  return `
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="4.1" cy="4.15" r="1.7" stroke="currentColor" stroke-width="1.25"></circle>
      <circle cx="4.1" cy="11.85" r="1.7" stroke="currentColor" stroke-width="1.25"></circle>
      <path d="m5.55 5.05 6.95 6.95M5.55 10.95 12.5 4" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"></path>
    </svg>
  `;
}

function editIconMarkup() {
  return `
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M10.95 3.05 12.95 5.05M3.75 12.25l2.55-.45 5.8-5.8a1.41 1.41 0 0 0-2-2l-5.8 5.8-.45 2.45Z" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"></path>
    </svg>
  `;
}

function speakerIconMarkup() {
  return `
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2.5 6.1h2.2l3.1-2.65v9.1L4.7 9.9H2.5z" stroke="currentColor" stroke-width="1.35" stroke-linejoin="round"></path>
      <path d="M10.2 5.25c.75.7 1.15 1.6 1.15 2.75s-.4 2.05-1.15 2.75" stroke="currentColor" stroke-width="1.35" stroke-linecap="round"></path>
      <path d="M12.1 3.7c1.16 1.12 1.75 2.55 1.75 4.3s-.59 3.18-1.75 4.3" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" opacity=".75"></path>
    </svg>
  `;
}

function terminalIconMarkup() {
  return `
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2.4" y="3.2" width="11.2" height="9.6" rx="1.8" stroke="currentColor" stroke-width="1.35"></rect>
      <path d="m4.9 6.15 1.95 1.85-1.95 1.85M8.2 9.85h3.1" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"></path>
    </svg>
  `;
}

function audioErrorIconMarkup() {
  return `
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 2.65 14 13H2L8 2.65Z" stroke="currentColor" stroke-width="1.35" stroke-linejoin="round"></path>
      <path d="M8 6.1v3.05M8 11.55h.01" stroke="currentColor" stroke-width="1.55" stroke-linecap="round"></path>
    </svg>
  `;
}

function audioLoadingMarkup() {
  return `
    <svg class="audio-loading-spinner" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle class="audio-loading-spinner__track" cx="8" cy="8" r="5.1" stroke="currentColor" stroke-width="1.35"></circle>
      <g class="audio-loading-spinner__rotor">
        <circle class="audio-loading-spinner__arc" cx="8" cy="8" r="5.1" stroke="currentColor" stroke-width="1.65" stroke-linecap="round"></circle>
        <circle class="audio-loading-spinner__dot" cx="8" cy="2.9" r="1.05" fill="currentColor"></circle>
      </g>
    </svg>
  `;
}

function stopAudioIconMarkup() {
  return `
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="4.35" y="4.35" width="7.3" height="7.3" rx="1.35" fill="currentColor"></rect>
    </svg>
  `;
}

function pauseAudioIconMarkup() {
  return `
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="4.6" y="4" width="2.4" height="8" rx=".8" fill="currentColor"></rect>
      <rect x="9" y="4" width="2.4" height="8" rx=".8" fill="currentColor"></rect>
    </svg>
  `;
}

function playAudioIconMarkup() {
  return `
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M5.2 3.9v8.2l6.3-4.1-6.3-4.1Z" fill="currentColor"></path>
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

function normalizeDelegateLaneId(value = "") {
  const raw = String(value || "default").trim().toLowerCase();
  const slug = raw
    .replace(/[^a-z0-9._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .replace(/-{2,}/gu, "-");
  return slug || "default";
}

function delegateStateKey(projectPath, laneId = "default") {
  return `${String(projectPath || "").trim()}::${normalizeDelegateLaneId(laneId)}`;
}

function delegateStateProjectPathFromKey(key = "", delegateState = null) {
  const explicit = String(
    delegateState?.status?.projectPath ||
      delegateState?.config?.projectPath ||
      delegateState?.projectPath ||
      "",
  ).trim();
  if (explicit) {
    return explicit;
  }
  const value = String(key || "").trim();
  const separatorIndex = value.lastIndexOf("::");
  return separatorIndex >= 0 ? value.slice(0, separatorIndex) : value;
}

function delegateStateLaneIdFromKey(key = "", delegateState = null) {
  const explicit = String(
    delegateState?.laneId ||
      delegateState?.status?.laneId ||
      delegateState?.config?.laneId ||
      "",
  ).trim();
  if (explicit) {
    return normalizeDelegateLaneId(explicit);
  }
  const value = String(key || "").trim();
  const separatorIndex = value.lastIndexOf("::");
  return normalizeDelegateLaneId(separatorIndex >= 0 ? value.slice(separatorIndex + 2) : "default");
}

function delegateStateEntriesForProject(projectPath = "") {
  const normalizedProjectPath = String(projectPath || "").trim();
  if (!normalizedProjectPath) {
    return [];
  }
  return Object.entries(state.delegatesByProject).filter(
    ([key, delegateState]) => delegateStateProjectPathFromKey(key, delegateState) === normalizedProjectPath,
  );
}

function projectDelegateLanes(project) {
  const lanes = Array.isArray(project?.delegateLanes) ? project.delegateLanes : [];
  if (lanes.length > 0) {
    return lanes;
  }
  return [
    {
      laneId: "default",
      displayName: "Default delegate",
      objective: "",
      status: project?.delegateStatus || null,
    },
  ];
}

function projectDelegateLaneItems(project) {
  if (!project?.path) {
    return [];
  }

  return projectDelegateLanes(project).map((lane) => {
    const laneId = normalizeDelegateLaneId(lane?.laneId || "default");
    const liveState = delegateStateFor(project.path, laneId);
    const liveStatus = liveState?.status ? normalizeDelegateStatus(liveState.status) : null;
    const catalogStatus = lane?.status ? normalizeDelegateStatus(lane.status) : null;
    const fallbackStatus =
      laneId === "default" && project?.delegateStatus ? normalizeDelegateStatus(project.delegateStatus) : null;
    const status = liveStatus || catalogStatus || fallbackStatus || null;
    return {
      ...project,
      laneId,
      delegateLane: {
        ...lane,
        laneId,
        status,
      },
      supervisor: liveState?.supervisor || null,
      delegateStatus: status && status.state !== "idle" ? status : null,
      currentObjective: String(lane?.objective || liveState?.config?.objective || "").trim(),
      latestOutcome: String(status?.lastOutcomeSummary || lane?.latestOutcome || "").trim(),
      nextAction: String(status?.nextAction || lane?.nextAction || "").trim(),
      hygieneState: String(status?.hygieneState || lane?.hygieneState || "").trim(),
      hygieneReason: String(status?.hygieneReason || lane?.hygieneReason || "").trim(),
      computeState: lane?.computeState || status?.computeBudget || null,
    };
  });
}

function activeDelegateItems() {
  return state.projects.flatMap((project) =>
    projectDelegateLaneItems(project)
      .filter((item) =>
        item.delegateStatus?.state === "running" ||
        item.delegateStatus?.state === "planning" ||
        Boolean(item.delegateStatus?.pauseRequested) ||
        delegateSupervisorIsActive({ supervisor: item.supervisor }),
      ),
  );
}

function projectDelegateStatus(project) {
  if (!project?.path) {
    return null;
  }

  const laneItems = projectDelegateLaneItems(project);
  const requestedLaneId = project.delegateLane?.laneId || project.laneId
    ? normalizeDelegateLaneId(project.delegateLane?.laneId || project.laneId || "default")
    : "";
  const matchingLane = requestedLaneId
    ? laneItems.find((lane) => lane.laneId === requestedLaneId) || null
    : laneItems.find((lane) => lane.delegateStatus) ||
      laneItems.find((lane) => lane.laneId === "default") ||
      laneItems[0] ||
      null;
  if (matchingLane?.delegateStatus) {
    return matchingLane.delegateStatus;
  }

  if (project.delegateStatus) {
    const normalizedProjectStatus = normalizeDelegateStatus(project.delegateStatus);
    return normalizedProjectStatus.state === "idle" ? null : normalizedProjectStatus;
  }

  return null;
}

function projectHasLiveDelegate(project) {
  return projectDelegateLaneItems(project).some((lane) => delegateCatalogStatusIsLive(lane.delegateStatus));
}

function projectHasActiveDelegateRun(project) {
  const status = projectDelegateStatus(project);
  if (!status) {
    return false;
  }
  return status.state === "running" || status.state === "planning" || Boolean(status.pauseRequested);
}

function activeDelegateProjects() {
  return activeDelegateItems();
}

function projectDelegateStatusMarker(project) {
  const status = projectDelegateStatus(project);
  if (!status) {
    return "";
  }
  if (status.pauseRequested || status.state === "paused") {
    return "\u23f8";
  }
  if (status.state === "running") {
    return "\u25cf";
  }
  if (status.state === "planning") {
    return "\u25cc";
  }
  return "";
}

function projectDelegateSummaryText(project) {
  const status = projectDelegateStatus(project);
  if (!status) {
    return "";
  }
  return shortDelegateRunText(
    status.error || status.lastOutcomeSummary || status.nextAction,
    status.state === "running" ? "Delegate running" : status.state === "planning" ? "Delegate planning" : "",
    140,
  );
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

function timestampToMs(value) {
  if (!value) {
    return 0;
  }
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function projectSessionActivityMs(session) {
  return timestampToMs(
    session?.lastActivityAt ||
      session?.providerLastActivity ||
      session?.lastResponse ||
      session?.lastDispatch ||
      session?.providerSessionTimestamp ||
      "",
  );
}

function projectLocalThreadActivityMs(project) {
  const projectPath = String(project?.path || "").trim();
  if (!projectPath) {
    return 0;
  }

  return state.threadEntries.reduce((latest, entry) => {
    if (String(entry?.projectPath || "").trim() !== projectPath) {
      return latest;
    }
    return Math.max(latest, timestampToMs(entry?.answeredAt), timestampToMs(entry?.sentAt));
  }, 0);
}

function projectActivityTimestampMs(project) {
  const sessionActivity = (Array.isArray(project?.sessions) ? project.sessions : []).reduce(
    (latest, session) => Math.max(latest, projectSessionActivityMs(session)),
    0,
  );
  return Math.max(
    sessionActivity,
    projectLocalThreadActivityMs(project),
    timestampToMs(project?.lastActivityAt),
    timestampToMs(project?.lastResponse),
    timestampToMs(project?.lastDispatch),
  );
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

  const activityDiff = projectActivityTimestampMs(right) - projectActivityTimestampMs(left);
  if (activityDiff !== 0) {
    return activityDiff;
  }

  const leftName = String(left?.displayName || left?.slug || left?.path || "");
  const rightName = String(right?.displayName || right?.slug || right?.path || "");
  return leftName.localeCompare(rightName);
}

function hydrateProjectVisuals(project) {
  if (!project?.path) {
    return project;
  }

  if (project.specialRole) {
    return {
      ...project,
      featured: Boolean(project.featured),
      featuredAccent: project.featuredAccent || "",
    };
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
  if (
    state.threadEntries.some(
      (entry) => threadEntryIsPending(entry) && threadEntryVisibleInQueue(entry, state.threadEntries),
    )
  ) {
    return true;
  }

  if (state.projects.some((project) => projectIsBusy(project))) {
    return true;
  }

  return currentThreadEntries().some(
    (entry) => threadEntryIsPending(entry) && threadEntryVisibleInQueue(entry, state.threadEntries),
  );
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

async function cutComposerDraft(input, writeText = copyText) {
  const text = String(input?.value || "");
  if (!text.trim()) {
    return false;
  }

  await writeText(text);
  input.value = "";
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

function normalizeQuickPromptId(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 96);
}

function newQuickPromptId() {
  return `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function normalizeQuickPrompt(prompt) {
  if (!prompt || typeof prompt !== "object") {
    return null;
  }
  const title = String(prompt.title || prompt.name || "")
    .trim()
    .slice(0, quickPromptTitleMax);
  const text = String(prompt.text || prompt.prompt || "")
    .trim()
    .slice(0, quickPromptTextMax);
  const id = normalizeQuickPromptId(prompt.id) || newQuickPromptId();
  if (!title || !text) {
    return null;
  }
  return {
    id,
    title,
    text,
    builtIn: prompt.builtIn === true || prompt.builtin === true,
  };
}

function normalizeQuickPrompts(prompts) {
  const usedIds = new Set();
  const normalized = [];
  for (const prompt of Array.isArray(prompts) ? prompts : []) {
    const entry = normalizeQuickPrompt(prompt);
    if (!entry) {
      continue;
    }
    let id = entry.id;
    if (usedIds.has(id)) {
      let suffix = 2;
      while (usedIds.has(`${id}-${suffix}`)) {
        suffix += 1;
      }
      id = `${id}-${suffix}`;
    }
    usedIds.add(id);
    normalized.push({ ...entry, id });
  }
  return normalized;
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

function sessionActivityTimestamp(session) {
  return (
    session?.lastActivityAt ||
    session?.providerLastActivity ||
    session?.lastResponse ||
    session?.lastDispatch ||
    session?.providerSessionTimestamp ||
    ""
  );
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
  const timestamp = formatTimestamp(sessionActivityTimestamp(session));
  return `${title} • ${sessionFixedSuffix(session)}${timestamp ? ` • ${timestamp}` : ""}`;
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

function currentCodexIntegrationProject() {
  return projectByPath(state.codexIntegrationModalProject) || null;
}

function currentArtifactsProject() {
  return projectByPath(state.artifactModalProject) || null;
}

function currentDelegateProject() {
  return projectByPath(state.delegateModalProject) || null;
}

function currentDelegateLaneId() {
  return normalizeDelegateLaneId(state.delegateModalLane);
}

function currentProjectRoot() {
  return state.projectRoots.find((root) => root.path === state.projectModalRoot) || null;
}

function currentRootRepos() {
  return Array.isArray(currentProjectRoot()?.repos) ? currentProjectRoot().repos : [];
}

function normalizeWorkspacePayload(value) {
  const workspace = value && typeof value === "object" ? value : {};
  const roots = Array.isArray(workspace.roots) ? workspace.roots.filter((root) => root?.path) : [];
  return {
    configured: Boolean(workspace.configured),
    setupRequired: Boolean(workspace.setupRequired),
    primaryRoot: String(workspace.primaryRoot || ""),
    primaryRootLabel: String(workspace.primaryRootLabel || workspace.primaryRoot || ""),
    roots,
    suggestions: Array.isArray(workspace.suggestions)
      ? workspace.suggestions.map((entry) => String(entry || "").trim()).filter(Boolean)
      : [],
  };
}

function normalizeWorkspaceRootDrafts(values = []) {
  const roots = [];
  const seen = new Set();
  const visit = (value) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const text = String(value || "").trim();
    if (!text || seen.has(text)) {
      return;
    }
    seen.add(text);
    roots.push(text);
  };
  visit(values);
  return roots;
}

function workspaceRootPaths(workspace = state.workspace) {
  return normalizeWorkspaceRootDrafts(
    (workspace?.roots || []).map((root) => root.path),
  );
}

function syncSettingsWorkspaceDraftsFromWorkspace() {
  const focus = state.workspace?.primaryRoot || state.workspaceSetupDraft || "";
  state.settingsWorkspaceFocusDraft = focus;
  state.settingsWorkspaceRootDrafts = workspaceRootPaths();
  state.settingsWorkspaceNewRootDraft = "";
}

function applyWorkspacePayload(workspace) {
  state.workspace = normalizeWorkspacePayload(workspace);
  if (!state.workspaceSetupDraft) {
    state.workspaceSetupDraft =
      state.workspace.primaryRoot ||
      state.workspace.suggestions[0] ||
      "";
  }
  if (!state.systemSetupWorkspaceDraft) {
    state.systemSetupWorkspaceDraft =
      state.workspace.primaryRoot ||
      state.workspace.suggestions[0] ||
      "";
  }
  if (!state.settingsModalOpen && !state.settingsWorkspaceFocusDraft) {
    syncSettingsWorkspaceDraftsFromWorkspace();
  }
}

function workspaceRootForProjectPath(projectPath) {
  const target = String(projectPath || "");
  const matches = (state.workspace?.roots || [])
    .filter((root) => target !== root.path && target.startsWith(`${root.path}/`))
    .sort((left, right) => right.path.length - left.path.length);
  return matches[0] || null;
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
            String(entry?.scheduleMode || entry?.dispatchMode || ""),
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

function detailHistoryDistanceFromBottom() {
  if (!elements.detailHistoryList) {
    return 0;
  }
  const { scrollTop, scrollHeight, clientHeight } = elements.detailHistoryList;
  return Math.max(0, scrollHeight - clientHeight - scrollTop);
}

function updateDetailScrollBottomButton() {
  if (!elements.detailScrollBottomButton || !elements.detailHistoryList) {
    return;
  }

  const modalThread = currentModalThread();
  const hasScrollableHistory =
    elements.detailHistoryList.scrollHeight > elements.detailHistoryList.clientHeight + 8;
  const showButton = Boolean(modalThread) && hasScrollableHistory && detailHistoryDistanceFromBottom() > 72;
  elements.detailScrollBottomButton.hidden = !showButton;
}

function scrollDetailHistoryToBottom({ smooth = true } = {}) {
  if (!elements.detailHistoryList) {
    return;
  }
  elements.detailHistoryList.scrollTo({
    top: elements.detailHistoryList.scrollHeight,
    behavior: smooth ? "smooth" : "auto",
  });
  window.requestAnimationFrame(updateDetailScrollBottomButton);
}

function applyDetailHistorySnapshot(snapshot) {
  if (!snapshot || !elements.detailHistoryList) {
    updateDetailScrollBottomButton();
    return;
  }

  window.requestAnimationFrame(() => {
    if (currentModalThreadKey() !== snapshot.threadKey) {
      return;
    }

    if (snapshot.mode === "prepend-older") {
      elements.detailHistoryList.scrollTop =
        elements.detailHistoryList.scrollHeight - snapshot.previousHeight + snapshot.previousTop;
      updateDetailScrollBottomButton();
      return;
    }

    if (snapshot.mode === "bottom" || snapshot.nearBottom) {
      elements.detailHistoryList.scrollTop = elements.detailHistoryList.scrollHeight;
      updateDetailScrollBottomButton();
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
        updateDetailScrollBottomButton();
        return;
      }
    }

    elements.detailHistoryList.scrollTop = snapshot.previousTop;
    updateDetailScrollBottomButton();
  });
}

function delegateRunKey(projectPath, runId, laneId = "default") {
  return `${delegateStateKey(projectPath, laneId)}::${String(runId || "").trim()}`;
}

function delegateCarouselSlideIndex(slideId = state.delegateCarouselSlide) {
  const index = delegateCarouselSlides.findIndex((slide) => slide.id === slideId);
  return index >= 0 ? index : 0;
}

function setDelegateCarouselSlide(slideId) {
  const nextSlide = delegateCarouselSlides.find((slide) => slide.id === slideId)?.id || "progress";
  state.delegateCarouselSlide = nextSlide;
  renderAll();
}

function advanceDelegateCarousel(direction) {
  const currentIndex = delegateCarouselSlideIndex();
  const nextIndex =
    (currentIndex + direction + delegateCarouselSlides.length) % delegateCarouselSlides.length;
  setDelegateCarouselSlide(delegateCarouselSlides[nextIndex].id);
}

function selectedDelegateRunId(projectPath, delegateState = delegateStateFor(projectPath), laneId = delegateState?.laneId || "default") {
  const key = delegateStateKey(projectPath, laneId);
  const selectedRunIdValue = String(state.delegateSelectedRunIds[key] || "").trim();
  const latestSummaryRunId = String(
    delegateState?.runSummarySnapshots?.find((snapshot) => snapshot?.runId && !delegateRunIsSidecarRunId(snapshot.runId))?.runId || "",
  ).trim();
  return (
    (delegateRunIsSidecarRunId(selectedRunIdValue) ? "" : selectedRunIdValue) ||
    (delegateRunIsSidecarRunId(delegateState?.status?.runId) ? "" : String(delegateState?.status?.runId || "").trim()) ||
    (delegateRunIsSidecarRunId(delegateState?.runLog?.runId) ? "" : String(delegateState?.runLog?.runId || "").trim()) ||
    (delegateRunIsSidecarRunId(delegateState?.latestRunSummarySnapshot?.runId)
      ? ""
      : String(delegateState?.latestRunSummarySnapshot?.runId || "").trim()) ||
    latestSummaryRunId
  );
}

function delegateLogModeFor(projectPath, laneId = "default") {
  const mode = String(state.delegateLogModes[delegateStateKey(projectPath, laneId)] || "").trim();
  return mode === "steps" ? "steps" : "live";
}

function setDelegateLogMode(projectPath, mode, laneId = "default") {
  const nextMode = mode === "steps" ? "steps" : "live";
  if (!projectPath || delegateLogModeFor(projectPath, laneId) === nextMode) {
    return;
  }
  state.delegateLogModes[delegateStateKey(projectPath, laneId)] = nextMode;
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
    const laneId = currentDelegateLaneId();
    const runId = delegateStateFor(project?.path || "", laneId).runLog?.runId || "";
    if (delegateRunKey(project?.path || "", runId, laneId) !== snapshot.runKey) {
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

function codexIntegrationStateFor(projectPath) {
  return (
    state.codexIntegrationByProject[projectPath] || {
      report: null,
      operations: [],
      loading: false,
      installing: false,
      initialized: false,
      error: "",
    }
  );
}

function setCodexIntegrationState(projectPath, nextState) {
  state.codexIntegrationByProject[projectPath] = {
    ...codexIntegrationStateFor(projectPath),
    ...nextState,
  };
}

function artifactsStateFor(projectPath) {
  return (
    state.artifactsByProject[projectPath] || {
    items: [],
    artifactRoot: "",
    dumpy: null,
    loading: false,
    initialized: false,
    loadedAt: 0,
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

function delegateStateFor(projectPath, laneId = "default") {
  const key = delegateStateKey(projectPath, laneId);
  return (
    state.delegatesByProject[key] || {
      laneId: normalizeDelegateLaneId(laneId),
      lanes: [],
      config: null,
      brief: "",
      status: null,
      supervisor: null,
      supervisorPreview: null,
      supervisorEvents: [],
      supervisorEventsCursor: "0",
      supervisorEventsTotal: 0,
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

function setDelegateState(projectPath, nextState, laneId = nextState?.laneId || "default") {
  const normalizedLaneId = normalizeDelegateLaneId(laneId);
  const key = delegateStateKey(projectPath, normalizedLaneId);
  state.delegatesByProject[key] = {
    ...delegateStateFor(projectPath, normalizedLaneId),
    laneId: normalizedLaneId,
    ...nextState,
  };
}

function delegatePayloadState(projectPath, payload = {}, { briefFallback = "" } = {}) {
  const laneId = normalizeDelegateLaneId(payload.laneId || payload.lane?.laneId || payload.config?.laneId || "default");
  const existing = delegateStateFor(projectPath, laneId);
  const hasBrief = Object.prototype.hasOwnProperty.call(payload, "brief");
  return {
    laneId,
    loading: false,
    initialized: true,
    error: "",
    lane: payload.lane || existing.lane || null,
    lanes: Array.isArray(payload.lanes) ? payload.lanes : existing.lanes,
    config: payload.config || existing.config || null,
    brief: hasBrief ? String(payload.brief || "") : String(briefFallback || existing.brief || ""),
    status: payload.status ? normalizeDelegateStatus(payload.status) : existing.status,
    supervisor: payload.supervisor ? normalizeDelegateSupervisorState(payload.supervisor) : existing.supervisor,
    supervisorPreview: payload.supervisorPreview || existing.supervisorPreview || null,
    supervisorEvents: Array.isArray(payload.supervisorEvents)
      ? payload.supervisorEvents.map(normalizeDelegateSupervisorEvent)
      : existing.supervisorEvents,
    supervisorEventsCursor: String(payload.supervisorEventsCursor || existing.supervisorEventsCursor || "0"),
    supervisorEventsTotal: Number.parseInt(String(payload.supervisorEventsTotal ?? existing.supervisorEventsTotal ?? "0"), 10) || 0,
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

function normalizeHistoryAttachments(attachments) {
  if (!Array.isArray(attachments)) {
    return [];
  }
  return attachments
    .map((attachment) => ({
      id: String(attachment?.id || "").trim() || makeEntryId(),
      fileName:
        String(attachment?.fileName || attachment?.originalName || attachment?.relativePath || "attachment")
          .split(/[\\/]/u)
          .pop()
          .trim() || "attachment",
      relativePath: String(attachment?.relativePath || "").trim(),
      path: String(attachment?.path || "").trim(),
      size: Number(attachment?.size || 0) || 0,
      mimeType: String(attachment?.mimeType || "").trim() || "application/octet-stream",
      kind: String(attachment?.kind || "").trim() || "file",
    }))
    .filter((attachment) => attachment.fileName);
}

function normalizeHistoryScheduleMode(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["queue", "queued", "next"].includes(normalized)) {
    return "queue";
  }
  if (["direct", "linear", "interject", "interrupt", "steer"].includes(normalized)) {
    return "direct";
  }
  return "";
}

function normalizeHistoryAudioManifest(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return null;
  }

  const parts = Array.isArray(manifest.parts) ? manifest.parts : [];
  const audioId = String(manifest.audioId || "").trim();
  const state = String(manifest.state || "").trim().toLowerCase();
  const error = String(manifest.error || "").trim();
  const errorCode = String(manifest.errorCode || manifest.code || "").trim();
  if (!audioId && !state && parts.length === 0 && !error && !errorCode) {
    return null;
  }

  return {
    audioId,
    state: state || (parts.length > 0 ? "ready" : "unknown"),
    provider: String(manifest.provider || "").trim(),
    voiceId: String(manifest.voiceId || "").trim(),
    modelId: String(manifest.modelId || "").trim(),
    outputFormat: String(manifest.outputFormat || "").trim(),
    textHash: String(manifest.textHash || manifest.source?.textHash || "").trim() || null,
    charCount: typeof manifest.charCount === "number" ? manifest.charCount : null,
    chunkCount: typeof manifest.chunkCount === "number" ? manifest.chunkCount : parts.length,
    cachedAt: String(manifest.cachedAt || manifest.updatedAt || manifest.createdAt || "").trim() || null,
    error: error || null,
    errorCode,
    retryAfterMs: Number.isFinite(Number.parseInt(String(manifest.retryAfterMs || "0"), 10))
      ? Number.parseInt(String(manifest.retryAfterMs || "0"), 10)
      : 0,
    unavailableUntil: String(manifest.unavailableUntil || "").trim() || null,
    source: manifest.source && typeof manifest.source === "object" && !Array.isArray(manifest.source)
      ? { ...manifest.source }
      : null,
    parts: parts
      .map((part) => ({
        index: typeof part?.index === "number" ? part.index : null,
        fileName: String(part?.fileName || "").trim(),
        bytes: typeof part?.bytes === "number" ? part.bytes : null,
        charCount: typeof part?.charCount === "number" ? part.charCount : null,
        url: String(part?.url || "").trim(),
      }))
      .filter((part) => part.fileName || part.url),
  };
}

function normalizeHistoryAudioMetadata(audio) {
  if (!audio || typeof audio !== "object" || Array.isArray(audio)) {
    return null;
  }

  const message = normalizeHistoryAudioManifest(audio.message);
  const response = normalizeHistoryAudioManifest(audio.response);
  if (!message && !response) {
    return null;
  }
  return {
    ...(message ? { message } : {}),
    ...(response ? { response } : {}),
  };
}

function audioManifestReady(audio) {
  return audio?.state === "ready" && Array.isArray(audio.parts) && audio.parts.some((part) => part?.url);
}

function audioManifestFailed(audio) {
  return audio?.state === "failed" || Boolean(String(audio?.error || "").trim());
}

function preferredHistoryAudioManifest(existingManifest = null, incomingManifest = null) {
  if (!existingManifest) {
    return incomingManifest || null;
  }
  if (!incomingManifest) {
    return existingManifest;
  }
  if (audioManifestReady(incomingManifest)) {
    return incomingManifest;
  }
  if (audioManifestReady(existingManifest)) {
    return existingManifest;
  }
  if (audioManifestFailed(incomingManifest)) {
    return incomingManifest;
  }
  return existingManifest;
}

function mergeHistoryAudioMetadata(existingAudio, incomingAudio) {
  const existing = normalizeHistoryAudioMetadata(existingAudio);
  const incoming = normalizeHistoryAudioMetadata(incomingAudio);
  if (!existing) {
    return incoming;
  }
  if (!incoming) {
    return existing;
  }
  const message = preferredHistoryAudioManifest(existing.message, incoming.message);
  const response = preferredHistoryAudioManifest(existing.response, incoming.response);
  if (!message && !response) {
    return null;
  }
  return {
    ...(message ? { message } : {}),
    ...(response ? { response } : {}),
  };
}

function normalizeHistoryItem(item) {
  const sessionId = String(item?.sessionId || "").trim();
  const provider = String(item?.provider || "").trim() || sessionForEntry(item)?.provider || "session";
  const rawStatus = String(item?.status || "queued").trim().toLowerCase() || "queued";
  const normalizedStatus = ["running", "dispatched", "dispatching", "starting"].includes(rawStatus)
    ? "working"
    : rawStatus;
  const answeredAt = String(item?.answeredAt || "").trim() || null;
  const scheduleMode = normalizeHistoryScheduleMode(item?.scheduleMode || item?.dispatchMode);
  const archivedAt = String(item?.archivedAt || "").trim() || null;
  const audio = normalizeHistoryAudioMetadata(item?.audio);
  const requestState = String(item?.requestState || item?.lifecycleState || "").trim().toLowerCase();
  const deliveryMechanism = String(item?.deliveryMechanism || "").trim().toLowerCase();
  return {
    requestId: String(item?.requestId || "").trim() || makeEntryId(),
    queueId: String(item?.queueId || "").trim() || null,
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
    scheduleMode,
    requestState,
    deliveryMechanism,
    handoffPending: Boolean(item?.handoffPending),
    archivedAt,
    attachments: normalizeHistoryAttachments(item?.attachments),
    ...(audio ? { audio } : {}),
    seenAt:
      String(item?.seenAt || "").trim() ||
      (normalizedStatus === "queued" || normalizedStatus === "working"
        ? null
        : answeredAt || String(item?.sentAt || "").trim() || new Date().toISOString()),
  };
}

function threadEntryStatus(entry) {
  return String(entry?.status || "").trim().toLowerCase();
}

function threadEntryIsPending(entry) {
  return threadEntryStatus(entry) === "queued" || threadEntryStatus(entry) === "working";
}

function threadEntryIsHistoryBackfill(entry) {
  return String(entry?.id || "").trim().startsWith("history:");
}

function threadEntryHasLaterSessionActivity(entry, items = state.threadEntries) {
  const projectPath = String(entry?.projectPath || "").trim();
  const sessionId = String(entry?.sessionId || "").trim();
  const sentAtMs = entrySentAtMs(entry);
  if (!projectPath || !sessionId || sentAtMs <= 0) {
    return false;
  }

  return (Array.isArray(items) ? items : []).some((candidate) => {
    if (candidate === entry) {
      return false;
    }
    if (
      String(candidate?.projectPath || "").trim() !== projectPath ||
      String(candidate?.sessionId || "").trim() !== sessionId
    ) {
      return false;
    }
    const candidateMs = Math.max(
      entrySentAtMs(candidate),
      new Date(candidate?.answeredAt || 0).getTime() || 0,
    );
    return Number.isFinite(candidateMs) && candidateMs > sentAtMs;
  });
}

function pendingThreadEntryVisibleInQueue(entry, items = state.threadEntries) {
  if (!threadEntryIsPending(entry)) {
    return false;
  }
  if (threadEntryHasLaterSessionActivity(entry, items)) {
    return false;
  }

  const session = sessionForEntry(entry);
  if (sessionIsBusy(session)) {
    return true;
  }

  if (threadEntryIsHistoryBackfill(entry)) {
    return false;
  }

  return !entryAgePastAttachGraceWindow(entry);
}

function threadEntryIsDirectAcknowledgement(entry) {
  const rawMode = String(entry?.scheduleMode || entry?.dispatchMode || "").trim().toLowerCase();
  const requestState = String(entry?.requestState || "").trim().toLowerCase();
  const deliveryMechanism = String(entry?.deliveryMechanism || "").trim().toLowerCase();
  return (
    ["interject", "interrupt", "steer"].includes(rawMode) ||
    (normalizeHistoryScheduleMode(rawMode) === "direct" &&
      (requestState === "direct" || deliveryMechanism === "turn_steer"))
  );
}

function historyEntryQueuedForLater(entry, items = []) {
  if (threadEntryStatus(entry) !== "queued") {
    return false;
  }
  if (normalizeHistoryScheduleMode(entry?.scheduleMode || entry?.dispatchMode) !== "queue") {
    return false;
  }

  const projectPath = String(entry?.projectPath || "").trim();
  const sessionId = String(entry?.sessionId || "").trim();
  if (!projectPath || !sessionId) {
    return false;
  }

  return true;
}

function threadEntryIsArchived(entry) {
  return Boolean(String(entry?.archivedAt || "").trim());
}

function threadEntryVisibleInQueue(entry, items = state.threadEntries) {
  if (threadEntryIsArchived(entry)) {
    return false;
  }
  const status = threadEntryStatus(entry);
  if (status === "queued" || status === "working") {
    return pendingThreadEntryVisibleInQueue(entry, items);
  }
  if (status === "answered" && threadEntryIsDirectAcknowledgement(entry)) {
    return false;
  }
  return status === "answered";
}

function historyItemStatusRank(status) {
  const normalized = String(status || "").trim().toLowerCase();
  return { queued: 1, working: 2, failed: 3, answered: 4 }[normalized] || 0;
}

function historyItemHasAnsweredResponse(item) {
  return (
    String(item?.status || "").trim().toLowerCase() === "answered" &&
    Boolean(String(item?.response || "").trim())
  );
}

function historyItemLooksLikeStaleDispatchFailure(item) {
  return (
    String(item?.status || "").trim().toLowerCase() === "failed" &&
    /Clawdad marked this dispatch failed because it went stale\./u.test(String(item?.response || ""))
  );
}

function historyItemHasConcreteRequestId(item) {
  const requestId = String(item?.requestId || "").trim();
  return Boolean(requestId) && !isSyntheticHistoryRequestId(requestId);
}

function historyItemHasSyntheticRequestId(item) {
  return isSyntheticHistoryRequestId(item?.requestId);
}

function historyItemsHaveSameSyntheticRequestId(left, right) {
  const leftRequestId = String(left?.requestId || "").trim();
  const rightRequestId = String(right?.requestId || "").trim();
  return (
    Boolean(leftRequestId) &&
    leftRequestId === rightRequestId &&
    isSyntheticHistoryRequestId(leftRequestId)
  );
}

function isSyntheticHistoryRequestId(value) {
  const requestId = String(value || "").trim();
  return (
    requestId.startsWith("codex:") ||
    requestId.startsWith("chimera:") ||
    requestId.startsWith("claude:")
  );
}

function stripClawdadHistoryHandoff(value) {
  return String(value || "")
    .replace(/\s*\[Clawdad (?:attachment|artifact) handoff:[\s\S]*?\]\s*/gu, " ")
    .replace(/\s*<image\b[\s\S]*?<\/image>\s*/giu, " ")
    .trim();
}

function comparableHistoryMessage(value) {
  return stripClawdadHistoryHandoff(value).replace(/\s+/g, " ").trim();
}

function isUnattachedLocalHistoryItem(item) {
  const status = String(item?.status || "").trim().toLowerCase();
  return (
    (status === "queued" || status === "working") &&
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
  const clearCachedSyntheticAnswer =
    historyItemsHaveSameSyntheticRequestId(existing, incoming) &&
    historyItemHasAnsweredResponse(existing) &&
    historyItemHasSyntheticRequestId(existing) &&
    historyItemHasSyntheticRequestId(incoming) &&
    !historyItemHasAnsweredResponse(incoming);
  const replaceCachedSyntheticAnswer =
    historyItemsHaveSameSyntheticRequestId(existing, incoming) &&
    historyItemHasAnsweredResponse(incoming) &&
    historyItemHasSyntheticRequestId(existing) &&
    historyItemHasSyntheticRequestId(incoming);
  const status = clearCachedSyntheticAnswer
    ? incoming?.status || "queued"
    : incomingRank >= existingRank
      ? incoming?.status
      : existing?.status;
  const existingConcreteAnswered =
    historyItemHasAnsweredResponse(existing) && historyItemHasConcreteRequestId(existing);
  const incomingConcreteAnswered =
    historyItemHasAnsweredResponse(incoming) && historyItemHasConcreteRequestId(incoming);
  const firstNonEmpty = (...values) => {
    for (const value of values) {
      const normalized = String(value || "").trim();
      if (normalized) {
        return normalized;
      }
    }
    return "";
  };
  const response = (() => {
    if (clearCachedSyntheticAnswer) {
      return String(incoming?.response || "");
    }
    if (replaceCachedSyntheticAnswer) {
      return String(incoming.response || "");
    }
    if (historyItemHasAnsweredResponse(existing) && historyItemLooksLikeStaleDispatchFailure(incoming)) {
      return String(existing.response || "");
    }
    if (historyItemHasAnsweredResponse(incoming) && historyItemLooksLikeStaleDispatchFailure(existing)) {
      return String(incoming.response || "");
    }
    if (status === "answered" && incomingConcreteAnswered && !existingConcreteAnswered) {
      return String(incoming.response || "");
    }
    if (status === "answered" && existingConcreteAnswered && !incomingConcreteAnswered) {
      return String(existing.response || "");
    }
    if (status === "answered" && historyItemHasAnsweredResponse(existing)) {
      return String(existing.response || "");
    }
    if (status === "answered" && historyItemHasAnsweredResponse(incoming)) {
      return String(incoming.response || "");
    }
    return String(incoming?.response || "").trim() || String(existing?.response || "");
  })();
  const existingRequestId = String(existing?.requestId || "").trim();
  const incomingRequestId = String(incoming?.requestId || "").trim();
  const requestId = (() => {
    if (incomingRequestId && !isSyntheticHistoryRequestId(incomingRequestId)) {
      return incomingRequestId;
    }
    if (existingRequestId && !isSyntheticHistoryRequestId(existingRequestId)) {
      return existingRequestId;
    }
    return incomingRequestId || existingRequestId;
  })();
  const projectPath = firstNonEmpty(incoming?.projectPath, existing?.projectPath);
  const sessionId = firstNonEmpty(incoming?.sessionId, existing?.sessionId);
  const sentAt = firstNonEmpty(existing?.sentAt, incoming?.sentAt);
  const answeredAt = clearCachedSyntheticAnswer
    ? firstNonEmpty(incoming?.answeredAt) || null
    : firstNonEmpty(incoming?.answeredAt, existing?.answeredAt);
  const exitCode = (() => {
    if (clearCachedSyntheticAnswer) {
      return typeof incoming?.exitCode === "number" ? incoming.exitCode : null;
    }
    if (typeof incoming?.exitCode === "number") {
      return incoming.exitCode;
    }
    return typeof existing?.exitCode === "number" ? existing.exitCode : null;
  })();
  const incomingMessage = String(incoming?.message || "");
  const existingMessage = String(existing?.message || "");
  const incomingAttachments = normalizeHistoryAttachments(incoming?.attachments);
  const existingAttachments = normalizeHistoryAttachments(existing?.attachments);
  const audio = mergeHistoryAudioMetadata(existing?.audio, incoming?.audio);
  const shouldKeepReturnedEntryUnread =
    threadEntryIsPending(existing) &&
    (status === "answered" || status === "failed");

  return {
    ...existing,
    ...incoming,
    id: firstNonEmpty(existing?.id, incoming?.id) || makeEntryId(),
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
    exitCode,
    scheduleMode:
      firstNonEmpty(
        normalizeHistoryScheduleMode(incoming?.scheduleMode || incoming?.dispatchMode),
        normalizeHistoryScheduleMode(existing?.scheduleMode || existing?.dispatchMode),
      ) || "",
    archivedAt: firstNonEmpty(existing?.archivedAt, incoming?.archivedAt) || null,
    attachments: incomingAttachments.length > 0 ? incomingAttachments : existingAttachments,
    ...(audio ? { audio } : {}),
    seenAt: shouldKeepReturnedEntryUnread
      ? null
      : String(existing?.seenAt || "").trim() ||
        String(incoming?.seenAt || "").trim() ||
        null,
  };
}

function historyAudioSignature(entry) {
  const audio = normalizeHistoryAudioMetadata(entry?.audio);
  const response = audio?.response;
  if (!response) {
    return "";
  }
  return [
    response.state || "",
    response.audioId || "",
    response.textHash || "",
    Array.isArray(response.parts) ? response.parts.length : 0,
    response.error || "",
  ].join(":");
}

function historyDisplayTimestampMs(entry) {
  const status = threadEntryStatus(entry);
  const primary =
    status === "queued" || status === "working"
      ? entry?.sentAt
      : entry?.answeredAt || entry?.sentAt;
  const value = new Date(primary || 0).getTime();
  return Number.isFinite(value) ? value : 0;
}

function compareHistoryDisplayOrder(left, right) {
  const activityDiff = historyDisplayTimestampMs(left) - historyDisplayTimestampMs(right);
  if (activityDiff !== 0) {
    return activityDiff;
  }

  const leftSentAt = new Date(left?.sentAt || 0).getTime();
  const rightSentAt = new Date(right?.sentAt || 0).getTime();
  const sentAtDiff =
    (Number.isFinite(leftSentAt) ? leftSentAt : 0) -
    (Number.isFinite(rightSentAt) ? rightSentAt : 0);
  if (sentAtDiff !== 0) {
    return sentAtDiff;
  }

  return String(left?.requestId || left?.id || "").localeCompare(String(right?.requestId || right?.id || ""));
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

  return merged.sort(compareHistoryDisplayOrder);
}

function trimThreadEntries(items = []) {
  const normalizedItems = Array.isArray(items) ? items : [];
  const pending = normalizedItems.filter(
    (entry) =>
      !threadEntryIsArchived(entry) &&
      pendingThreadEntryVisibleInQueue(entry, normalizedItems),
  );
  const archived = normalizedItems
    .filter(threadEntryIsArchived)
    .sort((left, right) => {
      const leftMs = new Date(left.archivedAt || left.answeredAt || left.sentAt || 0).getTime();
      const rightMs = new Date(right.archivedAt || right.answeredAt || right.sentAt || 0).getTime();
      return (Number.isFinite(rightMs) ? rightMs : 0) - (Number.isFinite(leftMs) ? leftMs : 0);
    })
    .slice(0, Math.max(0, threadEntryCacheLimit - pending.length));
  const returned = normalizedItems
    .filter((entry) => threadEntryStatus(entry) === "answered" && !threadEntryIsArchived(entry))
    .sort((left, right) => {
      const leftMs = new Date(left.answeredAt || left.sentAt || 0).getTime();
      const rightMs = new Date(right.answeredAt || right.sentAt || 0).getTime();
      return (Number.isFinite(rightMs) ? rightMs : 0) - (Number.isFinite(leftMs) ? leftMs : 0);
    })
    .slice(0, Math.max(0, threadEntryCacheLimit - pending.length - archived.length));

  return mergeHistoryItems([], [...pending, ...returned, ...archived]);
}

function threadEntryFromHistoryItem(item) {
  const normalized = normalizeHistoryItem(item);
  if (!normalized.projectPath || !normalized.sessionId) {
    return null;
  }

  const requestId = String(normalized.requestId || "").trim();
  return {
    ...normalized,
    id: requestId ? `history:${requestId}` : makeEntryId(),
    seenAt:
      normalized.status === "queued" || normalized.status === "working"
        ? normalized.seenAt || null
        : normalized.seenAt || normalized.answeredAt || normalized.sentAt || new Date().toISOString(),
  };
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

  if (typeof hydrateAudioAvailabilityFromHistoryItem === "function") {
    hydrateAudioAvailabilityFromHistoryItem(item);
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
    contextItemCount: Number.parseInt(String(snapshot?.contextItemCount || "0"), 10) || 0,
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

function normalizeDelegateCodexGoal(goal) {
  if (!goal || typeof goal !== "object") {
    return null;
  }
  const status = String(goal.status || "").trim();
  const mode = String(goal.mode || "auto").trim() || "auto";
  const supported = goal.supported === true ? true : goal.supported === false ? false : null;
  return {
    mode,
    supported,
    synced: Boolean(goal.synced),
    skipped: Boolean(goal.skipped),
    threadId: String(goal.threadId || goal.thread_id || "").trim() || null,
    objective: String(goal.objective || "").trim(),
    status: ["active", "paused", "budgetLimited", "complete"].includes(status) ? status : "",
    tokenBudget: Number.isFinite(Number(goal.tokenBudget)) ? Number(goal.tokenBudget) : null,
    tokensUsed: Number.isFinite(Number(goal.tokensUsed)) ? Number(goal.tokensUsed) : null,
    timeUsedSeconds: Number.isFinite(Number(goal.timeUsedSeconds)) ? Number(goal.timeUsedSeconds) : null,
    updatedAt: String(goal.updatedAt || goal.updated_at || "").trim() || null,
    error: String(goal.error || "").trim(),
  };
}

function normalizeDelegateStatus(status) {
  const normalizedState = String(status?.state || "idle").trim().toLowerCase();
  const stepCount = Number.parseInt(String(status?.stepCount || "0"), 10) || 0;
  const activeRequestId = String(status?.activeRequestId || status?.active_request_id || "").trim() || null;
  const activeStep = Number.parseInt(String(status?.activeStep ?? status?.active_step ?? ""), 10);
  const normalizedActiveStep = Number.isFinite(activeStep) && activeStep > 0 ? activeStep : null;
  return {
    laneId: normalizeDelegateLaneId(status?.laneId || status?.lane_id || "default"),
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
    hygieneState: String(status?.hygieneState || status?.hygiene_state || "").trim(),
    hygieneReason: String(status?.hygieneReason || status?.hygiene_reason || "").trim(),
    stopReason: String(status?.stopReason || "").trim(),
    pauseRequested: Boolean(status?.pauseRequested),
    codexGoal: normalizeDelegateCodexGoal(status?.codexGoal || status?.codex_goal),
    error: String(status?.error || "").trim(),
  };
}

function normalizeDelegateSupervisorState(supervisor) {
  if (!supervisor || typeof supervisor !== "object") {
    return null;
  }
  const stateValue = String(supervisor?.state || "stopped").trim().toLowerCase();
  const restartCount = Number.parseInt(String(supervisor?.restartCount || "0"), 10) || 0;
  const pid = Number.parseInt(String(supervisor?.pid || "0"), 10);
  return {
    laneId: normalizeDelegateLaneId(supervisor?.laneId || "default"),
    projectPath: String(supervisor?.projectPath || "").trim() || null,
    enabled: Boolean(supervisor?.enabled),
    state: ["idle", "running", "paused", "stopped", "blocked", "completed"].includes(stateValue)
      ? stateValue
      : "stopped",
    live: Boolean(supervisor?.live),
    pid: Number.isFinite(pid) && pid > 0 ? pid : null,
    startedAt: String(supervisor?.startedAt || "").trim() || null,
    updatedAt: String(supervisor?.updatedAt || "").trim() || null,
    stoppedAt: String(supervisor?.stoppedAt || "").trim() || null,
    intervalSeconds: Number.parseInt(String(supervisor?.intervalSeconds || "0"), 10) || null,
    maxRuns: Number.parseInt(String(supervisor?.maxRuns || "0"), 10) || null,
    restartCount: Math.max(0, restartCount),
    lastGateResult:
      supervisor?.lastGateResult && typeof supervisor.lastGateResult === "object"
        ? supervisor.lastGateResult
        : null,
    lastDirectionCheck:
      supervisor?.lastDirectionCheck && typeof supervisor.lastDirectionCheck === "object"
        ? supervisor.lastDirectionCheck
        : null,
    lastRestartAt: String(supervisor?.lastRestartAt || "").trim() || null,
    lastBlockerReason: String(supervisor?.lastBlockerReason || "").trim(),
    lastConsumedNextAction: String(supervisor?.lastConsumedNextAction || "").trim(),
    lastOutcome: String(supervisor?.lastOutcome || "").trim(),
    lastAction: String(supervisor?.lastAction || "").trim(),
  };
}

function normalizeDelegateSupervisorEvent(event) {
  const restartCount = Number.parseInt(String(event?.restartCount || "0"), 10) || 0;
  return {
    id: String(event?.id || "").trim() || makeEntryId(),
    at: String(event?.at || event?.createdAt || "").trim() || null,
    type: String(event?.type || "supervisor_event").trim() || "supervisor_event",
    laneId: normalizeDelegateLaneId(event?.laneId || event?.lane_id || "default"),
    action: String(event?.action || "").trim(),
    state: String(event?.state || "").trim(),
    reason: String(event?.reason || "").trim(),
    nextAction: String(event?.nextAction || event?.next_action || "").trim(),
    runId: String(event?.runId || event?.run_id || "").trim(),
    restartCount: Math.max(0, restartCount),
    payload: event?.payload && typeof event.payload === "object" ? event.payload : {},
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
    Boolean(state.delegateSupervisorPending) ||
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

  const normalizedStatus = projectCatalogDelegateStatus(status, projectPath);
  const laneId = normalizeDelegateLaneId(normalizedStatus?.laneId || status?.laneId || "default");
  const existingProject = state.projects[projectIndex];
  const delegateLanes = Array.isArray(existingProject.delegateLanes)
    ? (() => {
        let matched = false;
        const nextLanes = existingProject.delegateLanes.map((lane) => {
          if (normalizeDelegateLaneId(lane?.laneId) !== laneId) {
            return lane;
          }
          matched = true;
          return {
            ...lane,
            status: normalizedStatus,
            latestOutcome: normalizedStatus?.lastOutcomeSummary || lane?.latestOutcome || "",
            nextAction: normalizedStatus?.nextAction || lane?.nextAction || "",
            hygieneState: normalizedStatus?.hygieneState || lane?.hygieneState || "",
            hygieneReason: normalizedStatus?.hygieneReason || lane?.hygieneReason || "",
            computeState: normalizedStatus?.computeBudget || lane?.computeState || null,
          };
        });
        if (!matched) {
          nextLanes.push({
            laneId,
            displayName: laneId === "default" ? "Default delegate" : laneId,
            objective: "",
            status: normalizedStatus,
            latestOutcome: normalizedStatus?.lastOutcomeSummary || "",
            nextAction: normalizedStatus?.nextAction || "",
            hygieneState: normalizedStatus?.hygieneState || "",
            hygieneReason: normalizedStatus?.hygieneReason || "",
            computeState: normalizedStatus?.computeBudget || null,
          });
        }
        return nextLanes;
      })()
    : existingProject.delegateLanes;

  state.projects.splice(
    projectIndex,
    1,
    hydrateProjectVisuals({
      ...existingProject,
      delegateStatus: laneId === "default" ? normalizedStatus : existingProject.delegateStatus,
      delegateLanes,
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
  delete state.codexIntegrationByProject[normalizedProjectPath];
  delete state.artifactsByProject[normalizedProjectPath];
  for (const [key, delegateState] of Object.entries(state.delegatesByProject)) {
    if (delegateStateProjectPathFromKey(key, delegateState) === normalizedProjectPath) {
      delete state.delegatesByProject[key];
    }
  }
  for (const key of Object.keys(state.delegateSelectedRunIds)) {
    if (delegateStateProjectPathFromKey(key) === normalizedProjectPath) {
      delete state.delegateSelectedRunIds[key];
    }
  }
  for (const key of Object.keys(state.delegateLogModes)) {
    if (delegateStateProjectPathFromKey(key) === normalizedProjectPath) {
      delete state.delegateLogModes[key];
    }
  }
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
  if (state.codexIntegrationModalProject === normalizedProjectPath) {
    state.codexIntegrationModalProject = "";
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

function cacheableThreadEntries(items = state.threadEntries) {
  return (Array.isArray(items) ? items : []).filter((entry) => {
    const status = threadEntryStatus(entry);
    return (
      status !== "failed" &&
      (!threadEntryIsPending(entry) || !threadEntryIsHistoryBackfill(entry))
    );
  });
}

function persistThreadEntries() {
  try {
    localStorage.setItem(threadCacheKey, JSON.stringify(cacheableThreadEntries()));
  } catch (_error) {
    // Ignore storage failures.
  }
}

function readThreadEntryCache(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? cacheableThreadEntries(parsed) : [];
  } catch (_error) {
    return [];
  }
}

function threadEntryCacheKeysForRestore() {
  const keys = [threadCacheKey];
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (
        key &&
        key.startsWith("clawdad-thread-log-") &&
        key !== threadCacheKey &&
        !keys.includes(key)
      ) {
        keys.push(key);
      }
    }
  } catch (_error) {
    // Ignore storage failures.
  }
  return keys;
}

function restoreThreadEntries() {
  try {
    const caches = threadEntryCacheKeysForRestore()
      .map((key) => ({ key, items: readThreadEntryCache(key) }))
      .filter((entry) => entry.items !== null);
    if (caches.length === 0) {
      return;
    }

    const allItems = caches.flatMap((entry) => entry.items);
    state.threadEntries = trimThreadEntries(cacheableThreadEntries(mergeHistoryItems([], allItems)));
    persistThreadEntries();
  } catch (_error) {
    state.threadEntries = [];
  }
}

function purgeLegacyThreadEntryCaches() {
  try {
    restoreThreadEntries();
  } catch (_error) {
    // Ignore storage failures.
  }
}

function hydrateThreadEntriesFromHistoryItems(items = []) {
  const incoming = (Array.isArray(items) ? items : [])
    .map(threadEntryFromHistoryItem)
    .filter(Boolean);
  if (incoming.length === 0) {
    return false;
  }

  const beforeSignature = state.threadEntries
    .map((entry) => `${entry.id || ""}:${entry.requestId || ""}:${entry.status || ""}:${entry.answeredAt || ""}:${String(entry.response || "").length}:${historyAudioSignature(entry)}`)
    .join("|");
  state.threadEntries = trimThreadEntries(mergeHistoryItems(state.threadEntries, incoming));
  const afterSignature = state.threadEntries
    .map((entry) => `${entry.id || ""}:${entry.requestId || ""}:${entry.status || ""}:${entry.answeredAt || ""}:${String(entry.response || "").length}:${historyAudioSignature(entry)}`)
    .join("|");

  for (const entry of incoming) {
    hydrateHistoryFromThreadEntry(entry);
  }

  if (beforeSignature !== afterSignature) {
    persistThreadEntries();
    return true;
  }
  return false;
}

function cacheProjects(payload) {
  try {
    localStorage.setItem(
      projectCacheKey,
      JSON.stringify({
        selectedProject: state.selectedProject || "",
        selectedSessionId: state.selectedSessionId || "",
        defaultProject: payload.defaultProject || "",
        workspace: payload.workspace || state.workspace || null,
        projects: Array.isArray(payload.projects) ? payload.projects : [],
        recentThreads: Array.isArray(payload.recentThreads)
          ? payload.recentThreads
          : state.recentThreads,
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

    applyWorkspacePayload(payload.workspace);
    state.projects = projects;
    state.recentThreads = Array.isArray(payload.recentThreads)
      ? payload.recentThreads.map(normalizeRecentThreadSummary).filter(Boolean)
      : [];
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

function normalizeThreadScope(value) {
  return value === "all" ? "all" : "project";
}

function restoreThreadScope() {
  try {
    state.threadScope = normalizeThreadScope(localStorage.getItem(threadScopeKey));
  } catch (_error) {
    state.threadScope = "project";
  }
}

function setThreadScope(value) {
  state.threadScope = normalizeThreadScope(value);
  try {
    localStorage.setItem(threadScopeKey, state.threadScope);
  } catch (_error) {
    // Ignore storage failures.
  }
  renderAll();
}

function recentThreadActivityMs(thread) {
  return Math.max(
    timestampToMs(thread?.lastActivityAt),
    timestampToMs(thread?.providerLastActivity),
    timestampToMs(thread?.lastResponse),
    timestampToMs(thread?.lastDispatch),
    timestampToMs(thread?.providerSessionTimestamp),
    timestampToMs(thread?.lastSelectedAt),
  );
}

function normalizeRecentThreadSummary(thread, project = null) {
  const projectPath = String(thread?.projectPath || thread?.path || project?.path || "").trim();
  const sessionId = String(thread?.sessionId || "").trim();
  if (!projectPath || !sessionId) {
    return null;
  }
  const activityMs = recentThreadActivityMs(thread);
  return {
    projectName: String(
      thread?.projectName ||
      project?.displayName ||
      project?.slug ||
      projectPath.split("/").filter(Boolean).at(-1) ||
      "Project",
    ).trim(),
    projectPath,
    title: String(
      thread?.title ||
      thread?.slug ||
      sessionDisplayTitle(thread, projectPath) ||
      "Codex thread",
    ).trim(),
    provider: String(thread?.provider || project?.provider || "codex").trim() || "codex",
    sessionId,
    active: Boolean(thread?.active || project?.activeSessionId === sessionId),
    status: String(thread?.status || "idle").trim() || "idle",
    lastDispatch: String(thread?.lastDispatch || "").trim(),
    lastResponse: String(thread?.lastResponse || "").trim(),
    lastActivityAt: activityMs > 0
      ? new Date(activityMs).toISOString()
      : String(thread?.lastActivityAt || "").trim(),
  };
}

function recentThreadsFromProjects(projects = state.projects) {
  return (Array.isArray(projects) ? projects : []).flatMap((project) =>
    (Array.isArray(project?.sessions) ? project.sessions : [])
      .map((session) => normalizeRecentThreadSummary(session, project))
      .filter(Boolean),
  );
}

function mergeRecentThreadSummaries(threads = []) {
  const byThread = new Map();
  for (const rawThread of Array.isArray(threads) ? threads : []) {
    const thread = normalizeRecentThreadSummary(rawThread);
    if (!thread) {
      continue;
    }
    const key = `${thread.projectPath}::${thread.sessionId}`;
    const existing = byThread.get(key);
    if (!existing) {
      byThread.set(key, thread);
      continue;
    }
    const newer = recentThreadActivityMs(thread) >= recentThreadActivityMs(existing)
      ? thread
      : existing;
    const older = newer === thread ? existing : thread;
    byThread.set(key, {
      ...older,
      ...newer,
      active: Boolean(existing.active || thread.active),
      title: newer.title || older.title,
      lastDispatch: newer.lastDispatch || older.lastDispatch,
      lastResponse: newer.lastResponse || older.lastResponse,
    });
  }
  return [...byThread.values()].sort((left, right) => {
    const activityDelta = recentThreadActivityMs(right) - recentThreadActivityMs(left);
    if (activityDelta !== 0) {
      return activityDelta;
    }
    if (left.active !== right.active) {
      return left.active ? -1 : 1;
    }
    const projectDelta = left.projectName.localeCompare(right.projectName);
    return projectDelta || left.title.localeCompare(right.title) || left.sessionId.localeCompare(right.sessionId);
  });
}

function threadPreviewCards() {
  if (state.threadScope === "all") {
    const source = state.recentThreads.length > 0
      ? state.recentThreads
      : recentThreadsFromProjects();
    return mergeRecentThreadSummaries(source).slice(0, 20);
  }
  const project = currentProject();
  return mergeRecentThreadSummaries(recentThreadsFromProjects(project ? [project] : [])).slice(0, 20);
}

function currentThreadEntries() {
  return state.threadEntries
    .filter(
      (entry) =>
        entry.projectPath === state.selectedProject &&
        entry.sessionId === state.selectedSessionId,
    )
    .sort(compareHistoryDisplayOrder);
}

function queueEntryThreadKey(entry) {
  const projectPath = String(entry?.projectPath || "").trim();
  const sessionId = String(entry?.sessionId || "").trim();
  return projectPath && sessionId ? `${projectPath}::${sessionId}` : "";
}

function queueEntryStatusRank(entry) {
  const status = threadEntryStatus(entry);
  if (status === "working") {
    return 0;
  }
  if (status === "queued") {
    return 1;
  }
  if (status === "answered") {
    return 2;
  }
  return 3;
}

function queueEntryActivityMs(entry) {
  const value = new Date(entry?.answeredAt || entry?.sentAt || 0).getTime();
  return Number.isFinite(value) ? value : 0;
}

function compareQueueEntries(left, right) {
  const rankDiff = queueEntryStatusRank(left) - queueEntryStatusRank(right);
  if (rankDiff !== 0) {
    return rankDiff;
  }

  return queueEntryActivityMs(right) - queueEntryActivityMs(left);
}

function canonicalQueueEntries(entries = []) {
  const seenThreads = new Set();
  return entries.filter((entry) => {
    const threadKey = queueEntryThreadKey(entry);
    if (threadKey) {
      if (seenThreads.has(threadKey)) {
        return false;
      }
      seenThreads.add(threadKey);
    }
    return true;
  });
}

function queueEntries() {
  const visibleEntries = state.threadEntries
    .filter((entry) => threadEntryVisibleInQueue(entry, state.threadEntries))
    .sort(compareQueueEntries);
  return canonicalQueueEntries(visibleEntries);
}

function pendingEntryForSession(projectPath, sessionId) {
  return (
    state.threadEntries.find(
      (entry) => {
        if (
          entry.projectPath !== projectPath ||
          entry.sessionId !== sessionId ||
          !threadEntryIsPending(entry)
        ) {
          return false;
        }
        return pendingThreadEntryVisibleInQueue(entry, state.threadEntries);
      },
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

function terminalHistoryStatus(status) {
  const normalized = String(status || "").trim().toLowerCase();
  return normalized === "answered" || normalized === "failed" || normalized === "completed";
}

function historyStatusFromLifecycle(status) {
  const normalized = String(status || "").trim().toLowerCase();
  if (normalized === "completed") {
    return "answered";
  }
  if (normalized === "answered" || normalized === "failed") {
    return normalized;
  }
  if (["working", "running", "dispatched", "dispatching", "starting"].includes(normalized)) {
    return "working";
  }
  if (normalized === "queued") {
    return "queued";
  }
  return "";
}

function sessionDetailsForHistoryResult(project, fallbackSession, historyItem, mailboxStatus, entry) {
  const sessionId =
    String(historyItem?.sessionId || "").trim() ||
    String(mailboxStatus?.session_id || mailboxStatus?.sessionId || "").trim() ||
    String(fallbackSession?.sessionId || "").trim() ||
    String(entry?.sessionId || "").trim();
  const matchedSession =
    project?.sessions?.find((session) => session.sessionId === sessionId || session.slug === sessionId) ||
    null;
  return {
    sessionId,
    session:
      matchedSession ||
      fallbackSession ||
      {
        sessionId,
        provider: historyItem?.provider || fallbackSession?.provider || "session",
        slug: historyItem?.sessionSlug || entry?.sessionLabel || "",
        path: entry?.projectPath || project?.path || "",
      },
  };
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
  if (threadEntryIsPending(entry)) {
    return pendingThreadEntryLabel(entry);
  }
  if (threadEntryStatus(entry) === "failed") {
    return "failed";
  }
  return "cajun butter";
}

function pendingThreadEntryLabel(entry, items = state.threadEntries) {
  if (historyEntryQueuedForLater(entry, items)) {
    return "Queued";
  }
  if (entry?.handoffPending || String(entry?.requestState || "").trim().toLowerCase() === "starting") {
    return "Starting";
  }
  if (normalizeHistoryScheduleMode(entry?.scheduleMode || entry?.dispatchMode) === "queue") {
    return "Queued";
  }
  return currentProcessingPhrase();
}

function entryHasReturned(entry) {
  const status = threadEntryStatus(entry);
  return status === "answered" || status === "failed";
}

function entryIsUnread(entry) {
  return entryHasReturned(entry) && !String(entry?.seenAt || "").trim();
}

function hasUnreadQueueEntries() {
  return state.threadEntries
    .filter((entry) => threadEntryVisibleInQueue(entry, state.threadEntries))
    .some((entry) => entryIsUnread(entry));
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

function stableCopyHash(value) {
  let hash = 2166136261;
  for (const char of String(value || "")) {
    hash ^= char.codePointAt(0) || 0;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function ttsComparableText(value) {
  return String(value || "").trim();
}

function messageAudioTextFingerprint(text = "") {
  const value = ttsComparableText(text);
  const hash = stableCopyHash(value);
  return {
    text: value,
    length: value.length,
    hash,
    colonKey: `${value.length}:${hash}`,
    dashKey: `${value.length}-${hash}`,
  };
}

function entryCopyKey(entry, kind, text = "") {
  const parts = [
    kind,
    entry?.requestId,
    entry?.id,
    entry?.projectPath,
    entry?.sessionId,
    entry?.sentAt,
    entry?.answeredAt,
    entry?.status,
    stableCopyHash(text),
  ];
  return `entry-copy:${parts.map((part) => encodeURIComponent(String(part || ""))).join(":")}`;
}

function decorateCopyButton(button, copyKey) {
  const copied = copyFeedbackActive(copyKey);
  button.classList.toggle("is-copied", copied);
  button.innerHTML = copied ? checkIconMarkup() : copyIconMarkup();
}

function decorateComposerCutButton(button) {
  const cut = copyFeedbackActive(composerCutKey);
  button.classList.toggle("is-copied", cut);
  button.innerHTML = cut ? checkIconMarkup() : cutIconMarkup();
}

function announceComposerClipboardStatus(message) {
  const status = elements.composerClipboardStatus;
  if (!status) {
    return;
  }
  status.textContent = "";
  window.requestAnimationFrame(() => {
    status.textContent = String(message || "");
  });
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

function updateMessageCopyButton() {
  const button = elements.messageCopyButton;
  if (!button) {
    return;
  }
  const hasText = Boolean(String(elements.messageInput?.value || "").trim());
  button.dataset.copyKey = composerCopyKey;
  button.disabled = !hasText || state.composerCutPending;
  decorateCopyButton(button, composerCopyKey);
  const copied = copyFeedbackActive(composerCopyKey);
  const label = copied ? "Copied composer text" : "Copy composer text";
  button.setAttribute("aria-label", label);
  button.title = label;
}

function updateMessageCutButton() {
  const button = elements.messageCutButton;
  if (!button) {
    return;
  }
  const hasText = Boolean(String(elements.messageInput?.value || "").trim());
  const cut = copyFeedbackActive(composerCutKey);
  const pending = state.composerCutPending;
  button.disabled = !hasText || pending;
  button.setAttribute("aria-busy", String(pending));
  decorateComposerCutButton(button);
  const label = pending ? "Cutting draft" : cut ? "Draft cut" : "Cut draft";
  button.setAttribute("aria-label", label);
  button.title = label;
}

function terminalPanelIsOpen() {
  return Boolean(
    state.terminalPanel.projectPath &&
      state.terminalPanel.sessionId &&
      state.terminalPanel.requestId,
  );
}

function terminalStreamRequestKey(projectPath, sessionId, requestId) {
  return [
    String(projectPath || "").trim(),
    String(sessionId || "").trim(),
    String(requestId || "").trim(),
  ].join("::");
}

function terminalSessionKey(projectPath, sessionId) {
  return `${String(projectPath || "").trim()}::${String(sessionId || "").trim()}`;
}

function canOpenSessionInTerminal(entry) {
  const projectPath = String(entry?.projectPath || "").trim();
  const sessionId = String(entry?.sessionId || "").trim();
  return Boolean(projectPath && sessionId && !sessionId.startsWith("pending-create:"));
}

function canOpenTerminalStream(entry) {
  const requestId = String(entry?.requestId || "").trim();
  return Boolean(canOpenSessionInTerminal(entry) && requestId);
}

function currentSessionTerminalEntry() {
  const session = currentSession();
  return {
    projectPath: state.selectedProject,
    sessionId: state.selectedSessionId,
    provider: session?.provider || currentProject()?.provider || "codex",
  };
}

function decorateOpenTerminalButton(button, launchKey) {
  const pending = state.terminalLaunchPendingKey === launchKey;
  const visibleLabel = button.classList.contains("composer-tools-item")
    ? pending
      ? "Opening terminal"
      : "Open terminal"
    : "";
  button.disabled = pending;
  button.classList.toggle("is-loading", pending);
  button.innerHTML = visibleLabel
    ? `${terminalIconMarkup()}<span class="button-text">${visibleLabel}</span>`
    : terminalIconMarkup();
  button.setAttribute("aria-label", pending ? "Opening terminal" : "Open in terminal");
  button.title = pending ? "Opening terminal" : "Open in terminal";
}

async function openSessionInTerminal(entry) {
  const projectPath = String(entry?.projectPath || "").trim();
  const sessionId = String(entry?.sessionId || "").trim();
  const launchKey = terminalSessionKey(projectPath, sessionId);
  if (!projectPath || !sessionId || state.terminalLaunchPendingKey) {
    return;
  }

  state.terminalLaunchPendingKey = launchKey;
  renderAll();
  try {
    await fetchJson("/v1/session-terminal", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        project: projectPath,
        sessionId,
      }),
    });
  } catch (error) {
    showError(error);
  } finally {
    state.terminalLaunchPendingKey = "";
    renderAll();
  }
}

function terminalPanelStatusIsTerminal(status) {
  return Boolean(status?.terminal) || ["completed", "failed"].includes(String(status?.status || status?.state || "").toLowerCase());
}

function terminalPanelStatusLabel(status) {
  const normalized = String(status?.status || status?.state || "").trim().toLowerCase();
  if (normalized === "completed") {
    return "Completed";
  }
  if (normalized === "failed") {
    return "Failed";
  }
  if (normalized === "queued") {
    return "Queued";
  }
  if (normalized === "running" || normalized === "dispatched") {
    return "Running";
  }
  if (normalized === "idle" || normalized === "unknown") {
    return "Waiting";
  }
  return normalized ? normalized.replace(/\b\w/gu, (match) => match.toUpperCase()) : "Waiting";
}

function resetTerminalPanelState() {
  state.terminalPanel = {
    projectPath: "",
    sessionId: "",
    requestId: "",
    projectLabel: "",
    sessionLabel: "",
    events: [],
    nextCursor: "0",
    total: 0,
    loading: false,
    initialized: false,
    error: "",
    requestStatus: null,
  };
}

function stopTerminalPanelPolling() {
  if (terminalPanelPollTimer) {
    window.clearTimeout(terminalPanelPollTimer);
    terminalPanelPollTimer = null;
  }
}

function scheduleTerminalPanelPoll() {
  stopTerminalPanelPolling();
  if (!terminalPanelIsOpen() || terminalPanelStatusIsTerminal(state.terminalPanel.requestStatus)) {
    return;
  }
  terminalPanelPollTimer = window.setTimeout(() => {
    void loadTerminalStreamEvents({ append: true, quiet: true });
  }, terminalStreamPollMs);
}

function mergeTerminalStreamEvents(existingEvents = [], incomingEvents = []) {
  const byId = new Map();
  for (const event of [...existingEvents, ...incomingEvents]) {
    const id = String(event?.id || "").trim();
    if (!id) {
      continue;
    }
    byId.set(id, normalizeTerminalStreamEvent(event));
  }
  return [...byId.values()].sort((left, right) => {
    const leftMs = Date.parse(left.at || "");
    const rightMs = Date.parse(right.at || "");
    return (Number.isFinite(leftMs) ? leftMs : 0) - (Number.isFinite(rightMs) ? rightMs : 0);
  });
}

function normalizeTerminalStreamEvent(event = {}) {
  return {
    id: String(event.id || makeEntryId()).trim(),
    at: String(event.at || event.timestamp || "").trim(),
    type: String(event.type || "event").trim(),
    method: String(event.method || "").trim(),
    label: String(event.label || event.type || "Event").trim(),
    text: String(event.text || "").trim(),
    level: String(event.level || "info").trim(),
    status: String(event.status || "").trim(),
    itemType: String(event.itemType || "").trim(),
  };
}

function terminalPanelDistanceFromBottom() {
  const list = elements.terminalStreamList;
  if (!list) {
    return 0;
  }
  return list.scrollHeight - list.scrollTop - list.clientHeight;
}

function terminalPanelNearBottom() {
  const list = elements.terminalStreamList;
  return !list || terminalPanelDistanceFromBottom() < 96;
}

function scrollTerminalStreamToBottom({ smooth = false } = {}) {
  const list = elements.terminalStreamList;
  if (!list) {
    return;
  }
  list.scrollTo({
    top: list.scrollHeight,
    behavior: smooth ? "smooth" : "auto",
  });
}

function pushTerminalPanelHistory() {
  if (terminalPanelHistoryActive || !window.history?.pushState) {
    return;
  }
  const currentState =
    window.history.state && typeof window.history.state === "object"
      ? window.history.state
      : {};
  window.history.pushState(
    {
      ...currentState,
      clawdadTerminalPanel: true,
    },
    "",
    window.location.href,
  );
  terminalPanelHistoryActive = true;
}

function closeTerminalStreamPanel({ fromHistory = false, restoreFocus = true } = {}) {
  const wasOpen = terminalPanelIsOpen();
  stopTerminalPanelPolling();
  terminalPanelRequestSequence += 1;
  resetTerminalPanelState();
  renderAll();
  if (restoreFocus && terminalPanelReturnFocus instanceof HTMLElement) {
    terminalPanelReturnFocus.focus({ preventScroll: true });
  }
  terminalPanelReturnFocus = null;

  if (fromHistory) {
    terminalPanelHistoryActive = false;
    return;
  }
  if (
    wasOpen &&
    terminalPanelHistoryActive &&
    window.history?.state?.clawdadTerminalPanel &&
    window.history.back
  ) {
    window.history.back();
  } else {
    terminalPanelHistoryActive = false;
  }
}

async function loadTerminalStreamEvents({ append = false, quiet = false } = {}) {
  if (!terminalPanelIsOpen()) {
    return;
  }
  const requestKey = terminalStreamRequestKey(
    state.terminalPanel.projectPath,
    state.terminalPanel.sessionId,
    state.terminalPanel.requestId,
  );
  const sequence = ++terminalPanelRequestSequence;
  const cursor = append ? String(state.terminalPanel.nextCursor || "0") : "0";
  const shouldStick = terminalPanelStickToBottom || terminalPanelNearBottom();

  state.terminalPanel = {
    ...state.terminalPanel,
    loading: !quiet,
    error: "",
  };
  if (!quiet) {
    renderAll();
  }

  try {
    const query = new URLSearchParams({
      project: state.terminalPanel.projectPath,
      sessionId: state.terminalPanel.sessionId,
      requestId: state.terminalPanel.requestId,
      cursor,
      limit: String(terminalStreamPageSize),
    });
    const payload = await fetchJson(`/v1/session-terminal-log?${query.toString()}`);
    if (
      sequence !== terminalPanelRequestSequence ||
      requestKey !== terminalStreamRequestKey(
        state.terminalPanel.projectPath,
        state.terminalPanel.sessionId,
        state.terminalPanel.requestId,
      )
    ) {
      return;
    }
    const incomingEvents = Array.isArray(payload.events)
      ? payload.events.map(normalizeTerminalStreamEvent)
      : [];
    state.terminalPanel = {
      ...state.terminalPanel,
      events: mergeTerminalStreamEvents(append ? state.terminalPanel.events : [], incomingEvents),
      nextCursor: String(payload.nextCursor || "0"),
      total: Number.parseInt(String(payload.total || "0"), 10) || 0,
      requestStatus: payload.requestStatus || state.terminalPanel.requestStatus,
      loading: false,
      initialized: true,
      error: "",
    };
  } catch (error) {
    if (sequence !== terminalPanelRequestSequence) {
      return;
    }
    state.terminalPanel = {
      ...state.terminalPanel,
      loading: false,
      initialized: true,
      error: error.message,
    };
  }

  terminalPanelStickToBottom = shouldStick;
  renderAll();
  if (shouldStick) {
    window.requestAnimationFrame(() => scrollTerminalStreamToBottom());
  }
  scheduleTerminalPanelPoll();
}

async function openTerminalStreamPanel(entry, trigger = null) {
  const projectPath = String(entry?.projectPath || "").trim();
  const sessionId = String(entry?.sessionId || "").trim();
  const requestId = String(entry?.requestId || "").trim();
  if (!projectPath || !sessionId || !requestId) {
    return;
  }

  stopTerminalPanelPolling();
  terminalPanelRequestSequence += 1;
  terminalPanelReturnFocus = trigger instanceof HTMLElement ? trigger : document.activeElement;
  terminalPanelStickToBottom = true;
  state.terminalPanel = {
    projectPath,
    sessionId,
    requestId,
    projectLabel: String(entry?.projectLabel || entryProjectLabel(entry) || fallbackProjectLabel(projectPath)),
    sessionLabel: String(entry?.sessionLabel || entrySessionLabel(entry) || sessionId),
    events: [],
    nextCursor: "0",
    total: 0,
    loading: true,
    initialized: false,
    error: "",
    requestStatus: {
      requestId,
      sessionId,
      state: threadEntryStatus(entry),
      status: threadEntryStatus(entry) === "answered" ? "completed" : threadEntryStatus(entry),
      terminal: entryHasReturned(entry),
      active: !entryHasReturned(entry),
      source: "client",
      sentAt: String(entry?.sentAt || "").trim() || null,
      answeredAt: String(entry?.answeredAt || "").trim() || null,
      exitCode: null,
      error: threadEntryStatus(entry) === "failed" ? String(entry?.response || "").trim() || null : null,
    },
  };
  pushTerminalPanelHistory();
  renderAll();
  window.requestAnimationFrame(() => scrollTerminalStreamToBottom());
  await loadTerminalStreamEvents({ append: false });
}

function buildTerminalStreamButton(entry) {
  const projectPath = String(entry?.projectPath || "").trim();
  const sessionId = String(entry?.sessionId || "").trim();
  const requestId = String(entry?.requestId || "").trim();
  const launchKey = terminalStreamRequestKey(projectPath, sessionId, requestId);
  const button = document.createElement("button");
  button.type = "button";
  button.className = "copy-button copy-button-floating open-terminal-button terminal-stream-button";
  button.dataset.terminalStreamKey = launchKey;
  button.innerHTML = terminalIconMarkup();
  button.setAttribute("aria-label", "Open terminal stream");
  button.title = "Open terminal stream";
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    void openTerminalStreamPanel(entry, button);
  });
  return button;
}

function buildOpenTerminalButton(entry) {
  const projectPath = String(entry?.projectPath || "").trim();
  const sessionId = String(entry?.sessionId || "").trim();
  const launchKey = terminalSessionKey(projectPath, sessionId);
  const button = document.createElement("button");
  button.type = "button";
  button.className = "copy-button copy-button-floating open-terminal-button";
  button.dataset.terminalLaunchKey = launchKey;
  decorateOpenTerminalButton(button, launchKey);
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    void openSessionInTerminal(entry);
  });
  return button;
}

function audioAvailability(audioKey) {
  return state.audioAvailability[audioKey] || { status: "idle" };
}

function setAudioAvailability(audioKey, patch = {}, { render = true } = {}) {
  if (!audioKey) {
    return;
  }

  const current = audioAvailability(audioKey);
  const next = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  state.audioAvailability = {
    ...state.audioAvailability,
    [audioKey]: next,
  };
  if (render) {
    renderAll();
  }
}

function audioPartsFromAvailability(audioKey) {
  const availability = audioAvailability(audioKey);
  const parts = Array.isArray(availability?.audio?.parts)
    ? availability.audio.parts.filter((part) => part?.url)
    : [];
  return availability.status === "ready" && parts.length > 0 ? parts : [];
}

function normalizeTtsStatus(value = {}) {
  const source = value?.ttsStatus || value?.tts || value || {};
  const enabled = source.enabled !== false;
  const available = enabled && source.available !== false;
  const retryAfterMs = Number.parseInt(String(source.retryAfterMs || "0"), 10);
  return {
    loaded: Boolean(source.loaded || value?.ttsStatus || value?.tts),
    enabled,
    available,
    error: String(source.error || "").trim(),
    errorCode: String(source.errorCode || source.code || "").trim(),
    retryAfterMs: Number.isFinite(retryAfterMs) && retryAfterMs > 0 ? retryAfterMs : 0,
    unavailableUntil: String(source.unavailableUntil || "").trim() || null,
  };
}

function setTtsStatus(value = {}, { render = false } = {}) {
  state.ttsStatus = normalizeTtsStatus({
    ...state.ttsStatus,
    ...value,
    loaded: true,
  });
  if (render) {
    renderAll();
  }
  return state.ttsStatus;
}

function ttsUnavailableMessage(status = state.ttsStatus) {
  const normalized = normalizeTtsStatus(status);
  if (normalized.available) {
    return "";
  }
  if (normalized.errorCode === "insufficient_funds") {
    return "Text-to-speech failed: insufficient OpenAI funds or credits. Update OpenAI billing, recharge the budget, or use an API key with available credits.";
  }
  if (normalized.errorCode === "quota_exceeded") {
    return "Text-to-speech quota or rate limit was reached. Saved audio can still play.";
  }
  if (normalized.errorCode === "rate_limited") {
    return "Text-to-speech is temporarily rate limited by OpenAI. Try again after the retry window.";
  }
  if (normalized.errorCode === "not_configured") {
    return "Text-to-speech provider is not configured.";
  }
  if (normalized.errorCode === "local_service_not_configured") {
    return "ClawDad local text-to-speech is missing a local speech service URL.";
  }
  if (normalized.errorCode === "local_service_unavailable") {
    return "ClawDad local text-to-speech is unavailable. Start the local speech service and try again.";
  }
  if (normalized.errorCode === "disabled") {
    return "Text-to-speech is disabled on this Clawdad server.";
  }
  if (normalized.error) {
    return normalized.error;
  }
  return "Text-to-speech is temporarily unavailable.";
}

function ttsStatusBlocksGeneration() {
  return state.ttsStatus?.loaded && !normalizeTtsStatus(state.ttsStatus).available;
}

function ttsUnavailableFromErrorPayload(payload = {}) {
  const statusPayload = payload?.ttsStatus || payload?.tts;
  if (statusPayload) {
    return setTtsStatus(statusPayload);
  }
  const errorCode = String(payload?.errorCode || "").trim();
  if (
    [
      "insufficient_funds",
      "quota_exceeded",
      "rate_limited",
      "not_configured",
      "local_service_not_configured",
      "local_service_unavailable",
      "disabled",
      "unsupported",
    ]
      .includes(errorCode)
  ) {
    return setTtsStatus({
      available: false,
      error: String(payload?.error || "").trim(),
      errorCode,
      retryAfterMs: payload?.retryAfterMs,
      unavailableUntil: payload?.unavailableUntil,
    });
  }
  return null;
}

function ttsErrorCodeFromMessage(error = "") {
  const message = String(error || "").trim();
  if (
    /insufficient[_ -]?quota|exceeded your current quota|billing|payment|credit|funds|balance|hard limit/iu
      .test(message)
  ) {
    return "insufficient_funds";
  }
  if (/rate limit|too many requests|temporarily limited/iu.test(message)) {
    return "rate_limited";
  }
  if (/quota|status 429/iu.test(message)) {
    return "quota_exceeded";
  }
  if (/doc reader.*not configured|local speech.*not configured|local text-to-speech.*not configured/iu.test(message)) {
    return "local_service_not_configured";
  }
  if (/doc reader|local speech|local text-to-speech|econnrefused|econnreset|enotfound|fetch failed/iu.test(message)) {
    return "local_service_unavailable";
  }
  if (/api key|not configured/iu.test(message)) {
    return "not_configured";
  }
  if (/disabled/iu.test(message)) {
    return "disabled";
  }
  return "";
}

function ttsErrorImpliesUnavailable(errorCode = "", error = "") {
  const code = String(errorCode || ttsErrorCodeFromMessage(error) || "").trim();
  const message = String(error || "").trim();
  return [
    "insufficient_funds",
    "quota_exceeded",
    "rate_limited",
    "not_configured",
    "local_service_not_configured",
    "local_service_unavailable",
    "disabled",
    "unsupported",
  ]
    .includes(code) ||
    /quota|exceeded your current quota|billing|payment|credit|funds|api key|not configured|doc reader|local speech|local text-to-speech|disabled/iu
      .test(message);
}

function showAudioStatus(message) {
  const text = String(message || "").trim();
  if (!text) {
    return;
  }
  setText(elements.mailboxState, text, { empty: false });
  if (audioNoticeTimer) {
    window.clearTimeout(audioNoticeTimer);
  }
  audioNoticeTimer = window.setTimeout(() => {
    audioNoticeTimer = null;
    updateMailboxState();
  }, 4500);
}

async function refreshTtsStatus({ quiet = false } = {}) {
  try {
    const payload = await fetchJson("/v1/tts/status");
    setTtsStatus(payload?.ttsStatus || payload?.tts || payload, { render: false });
  } catch (error) {
    if (!quiet) {
      showAudioStatus(error.message || "Text-to-speech status is unavailable.");
    }
  }
}

function clearAudioPrepareTimer(audioKey) {
  const timer = audioPrepareTimers.get(audioKey);
  if (timer) {
    window.clearTimeout(timer);
    audioPrepareTimers.delete(audioKey);
  }
}

function scheduleAudioPreparePoll(audioKey, payload) {
  if (!audioKey || audioPrepareTimers.has(audioKey)) {
    return;
  }
  const timer = window.setTimeout(() => {
    audioPrepareTimers.delete(audioKey);
    void prepareMessageAudio(audioKey, payload, {
      poll: true,
      background: true,
    });
  }, ttsPreparePollMs);
  audioPrepareTimers.set(audioKey, timer);
}

async function prepareMessageAudio(
  audioKey,
  payload,
  { poll = false, background = true } = {},
) {
  if (!audioKey || !payload?.project) {
    return null;
  }

  const current = audioAvailability(audioKey);
  const currentReady = audioPartsFromAvailability(audioKey).length > 0;
  if (!poll && current.status === "ready" && currentReady) {
    return current.audio || null;
  }
  if (!poll && background && current.status === "preparing") {
    scheduleAudioPreparePoll(audioKey, payload);
    return current.audio || null;
  }

  const existingPreparePromise = audioPreparePromises.get(audioKey);
  if (existingPreparePromise && (background || poll)) {
    return existingPreparePromise;
  }

  if (!currentReady && ttsStatusBlocksGeneration()) {
    const message = ttsUnavailableMessage();
    setAudioAvailability(audioKey, {
      status: "unavailable",
      error: message,
      errorCode: state.ttsStatus?.errorCode || "",
    });
    if (!background) {
      showAudioStatus(message);
    }
    return null;
  }

  setAudioAvailability(audioKey, { status: "preparing", error: "", playbackError: "" });
  const trackPreparePromise = background || poll;
  const promise = (async () => {
    try {
      const response = await fetchJson("/v1/tts/message", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...payload,
          async: Boolean(background || poll),
          poll: Boolean(poll),
          retry: current.status === "error",
        }),
      });
      const parts = Array.isArray(response?.audio?.parts)
        ? response.audio.parts.filter((part) => part?.url)
        : [];
      if (response?.audio?.state === "ready" && parts.length > 0) {
        clearAudioPrepareTimer(audioKey);
        setAudioAvailability(audioKey, {
          status: "ready",
          audio: response.audio,
          error: "",
          playbackError: "",
        });
        return response.audio;
      }

      if (audioPartsFromAvailability(audioKey).length > 0) {
        return audioAvailability(audioKey).audio || null;
      }
      setAudioAvailability(audioKey, {
        status: "preparing",
        audio: response?.audio || current.audio || null,
        error: "",
        playbackError: "",
      });
      scheduleAudioPreparePoll(audioKey, payload);
      return response?.audio || null;
    } catch (error) {
      clearAudioPrepareTimer(audioKey);
      if (audioPartsFromAvailability(audioKey).length > 0) {
        return audioAvailability(audioKey).audio || null;
      }
      const unavailableStatus = ttsUnavailableFromErrorPayload(error.payload);
      const unavailable = unavailableStatus && !unavailableStatus.available;
      const message =
        (unavailable ? ttsUnavailableMessage(unavailableStatus) : "") ||
        error.message ||
        "Audio is not available.";
      setAudioAvailability(audioKey, {
        status: unavailable ? "unavailable" : "error",
        error: message,
        errorCode: error.payload?.errorCode || unavailableStatus?.errorCode || "",
        playbackError: message,
      });
      if (!background) {
        showAudioStatus(message);
      }
      return null;
    } finally {
      if (audioPreparePromises.get(audioKey) === promise) {
        audioPreparePromises.delete(audioKey);
      }
    }
  })();
  if (trackPreparePromise) {
    audioPreparePromises.set(audioKey, promise);
  }
  return promise;
}

function audioPlaybackStatus(audioKey) {
  return state.audioPlayback.key === audioKey ? state.audioPlayback.status || "idle" : "idle";
}

function setAudioPlaybackStatus(audioKey = "", status = "idle") {
  state.audioPlayback = {
    key: status === "idle" ? "" : audioKey,
    status,
  };
  renderAll();
}

function decorateAudioButton(button, audioKey) {
  const status = audioPlaybackStatus(audioKey);
  const availability = audioAvailability(audioKey);
  const preparing = availability.status === "preparing";
  const ready = audioPartsFromAvailability(audioKey).length > 0;
  const playbackError = ready && status === "idle" && String(availability.playbackError || "").trim();
  const unavailable = availability.status === "unavailable" && !ready;
  const failed = availability.status === "error" && !ready;
  const loading = status === "loading" || preparing;
  button.dataset.audioAction = "tts";
  button.disabled = false;
  button.removeAttribute("aria-disabled");
  button.classList.toggle("is-ready", ready);
  button.classList.toggle("is-preparing", preparing);
  button.classList.toggle("is-unavailable", unavailable || failed || Boolean(playbackError));
  button.classList.remove("is-download");
  button.classList.toggle("is-loading", loading);
  button.classList.toggle("is-playing", status === "playing");
  button.classList.toggle("is-paused", status === "paused");
  if (status === "loading") {
    button.innerHTML = audioLoadingMarkup();
    button.setAttribute("aria-label", "Starting audio");
    button.title = "Starting audio";
    return;
  }
  if (status === "playing") {
    button.innerHTML = pauseAudioIconMarkup();
    button.setAttribute("aria-label", "Pause audio");
    button.title = "Pause audio";
    return;
  }
  if (status === "paused") {
    button.innerHTML = playAudioIconMarkup();
    button.setAttribute("aria-label", "Resume audio");
    button.title = "Resume audio";
    return;
  }
  if (preparing) {
    button.innerHTML = audioLoadingMarkup();
    button.setAttribute("aria-label", "Preparing audio");
    button.title = "Preparing audio. Tap to play when ready.";
    return;
  }
  if (playbackError) {
    button.innerHTML = audioErrorIconMarkup();
    button.setAttribute("aria-label", `Audio failed. ${playbackError}`);
    button.title = playbackError;
    return;
  }
  if (failed) {
    const errorCode = availability.errorCode || ttsErrorCodeFromMessage(availability.error);
    const message = ttsUnavailableMessage({
      available: false,
      errorCode,
      error: availability.error,
    }) || availability.error || "Audio is not available. Click to retry.";
    button.innerHTML = audioErrorIconMarkup();
    button.setAttribute("aria-label", `Audio failed. ${message}`);
    button.title = message;
    return;
  }
  if (unavailable) {
    const errorCode = availability.errorCode || ttsErrorCodeFromMessage(availability.error);
    const message = ttsUnavailableMessage({
      available: false,
      errorCode,
      error: availability.error,
    }) || availability.error || "Text-to-speech is unavailable.";
    button.innerHTML = audioErrorIconMarkup();
    button.setAttribute("aria-label", message);
    button.setAttribute("aria-disabled", "true");
    button.title = message;
    return;
  }
  if (!ready) {
    const label = button.dataset.audioPrepareLabel || button.dataset.audioPlayLabel || "Play audio";
    button.innerHTML = speakerIconMarkup();
    button.setAttribute("aria-label", label);
    button.title = label;
    return;
  }
  button.innerHTML = speakerIconMarkup();
  button.setAttribute("aria-label", button.dataset.audioPlayLabel || "Play audio");
  button.title = button.dataset.audioPlayLabel || "Play audio";
}

function updateAudioLoadingSpinnerFrame(timestamp = window.performance?.now?.() || Date.now()) {
  const rotors = Array.from(document.querySelectorAll(".message-audio-button.is-loading .audio-loading-spinner__rotor"));
  if (rotors.length === 0) {
    audioLoadingSpinnerFrameRequest = 0;
    audioLoadingSpinnerFrameStartedAt = 0;
    return;
  }

  if (!audioLoadingSpinnerFrameStartedAt) {
    audioLoadingSpinnerFrameStartedAt = timestamp;
  }
  const elapsedMs = Math.max(0, timestamp - audioLoadingSpinnerFrameStartedAt);
  const angle = ((elapsedMs % audioLoadingSpinnerFrameMs) / audioLoadingSpinnerFrameMs) * 360;
  for (const rotor of rotors) {
    rotor.style.transform = `rotate(${angle.toFixed(2)}deg)`;
  }
  audioLoadingSpinnerFrameRequest = window.requestAnimationFrame(updateAudioLoadingSpinnerFrame);
}

function syncAudioLoadingSpinnerAnimation() {
  const hasLoadingSpinner = Boolean(document.querySelector(".message-audio-button.is-loading .audio-loading-spinner__rotor"));
  if (!hasLoadingSpinner || audioLoadingSpinnerFrameRequest) {
    return;
  }
  audioLoadingSpinnerFrameStartedAt = window.performance?.now?.() || Date.now();
  audioLoadingSpinnerFrameRequest = window.requestAnimationFrame(updateAudioLoadingSpinnerFrame);
}

function ttsFallbackText(text) {
  const value = String(text || "");
  return value.length <= ttsInlineTextLimit ? value : "";
}

function createMessageAudioPlayback(audioKey) {
  return {
    key: audioKey,
    audio: new Audio(),
    paused: false,
    stopped: false,
    priming: false,
    finishCurrent: null,
  };
}

function createSilentWavObjectUrl({ durationMs = 120, sampleRate = 8000 } = {}) {
  const samples = Math.max(1, Math.round((sampleRate * durationMs) / 1000));
  const bytesPerSample = 2;
  const dataBytes = samples * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  let offset = 0;
  const writeAscii = (value) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
    offset += value.length;
  };
  writeAscii("RIFF");
  view.setUint32(offset, 36 + dataBytes, true);
  offset += 4;
  writeAscii("WAVE");
  writeAscii("fmt ");
  view.setUint32(offset, 16, true);
  offset += 4;
  view.setUint16(offset, 1, true);
  offset += 2;
  view.setUint16(offset, 1, true);
  offset += 2;
  view.setUint32(offset, sampleRate, true);
  offset += 4;
  view.setUint32(offset, sampleRate * bytesPerSample, true);
  offset += 4;
  view.setUint16(offset, bytesPerSample, true);
  offset += 2;
  view.setUint16(offset, 16, true);
  offset += 2;
  writeAscii("data");
  view.setUint32(offset, dataBytes, true);
  return URL.createObjectURL(new Blob([buffer], { type: "audio/wav" }));
}

function primeMessageAudioPlayback(audioKey) {
  if (!audioKey) {
    return null;
  }
  const playback =
    activeMessageAudio?.key === audioKey && !activeMessageAudio.stopped
      ? activeMessageAudio
      : reserveMessageAudioPlayback(audioKey);
  if (!playback?.audio || playback.priming) {
    return playback;
  }

  playback.priming = true;
  const audio = playback.audio;
  const priorVolume = typeof audio.volume === "number" ? audio.volume : 1;
  const objectUrl = createSilentWavObjectUrl();
  let cleanupTimer = null;
  const cleanup = () => {
    if (cleanupTimer) {
      window.clearTimeout(cleanupTimer);
      cleanupTimer = null;
    }
    audio.removeEventListener("ended", cleanup);
    audio.removeEventListener("error", cleanup);
    if (playback.priming) {
      playback.priming = false;
    }
    if (audio.src === objectUrl) {
      try {
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
      } catch (_error) {
        // Best effort only; real playback will replace the source.
      }
    }
    audio.volume = priorVolume;
    URL.revokeObjectURL(objectUrl);
  };

  audio.addEventListener("ended", cleanup, { once: true });
  audio.addEventListener("error", cleanup, { once: true });
  audio.preload = "auto";
  audio.volume = 0;
  audio.src = objectUrl;
  audio.load();
  try {
    const playPromise = audio.play();
    if (playPromise && typeof playPromise.finally === "function") {
      playPromise.finally(cleanup).catch(() => {});
    }
  } catch (_error) {
    cleanup();
  }
  cleanupTimer = window.setTimeout(cleanup, 900);
  return playback;
}

function reserveMessageAudioPlayback(audioKey) {
  if (activeMessageAudio?.key === audioKey && !activeMessageAudio.stopped) {
    return activeMessageAudio;
  }
  stopActiveMessageAudio({ render: false });
  const playback = createMessageAudioPlayback(audioKey);
  activeMessageAudio = playback;
  return playback;
}

function stopActiveMessageAudio({ render = true } = {}) {
  const playback = activeMessageAudio;
  const audioKey = playback?.key || state.audioPlayback.key || "";
  if (playback) {
    playback.stopped = true;
    if (typeof playback.finishCurrent === "function") {
      playback.finishCurrent();
    }
  }
  if (playback?.audio) {
    try {
      playback.audio.pause();
      playback.audio.removeAttribute("src");
      playback.audio.load();
    } catch (_error) {
      // Best effort cleanup for mobile browsers.
    }
  }
  activeMessageAudio = null;
  if (audioKey) {
    clearAudioPrepareTimer(audioKey);
  }
  if (state.audioPlayback.status !== "idle") {
    if (render) {
      setAudioPlaybackStatus("", "idle");
    } else {
      state.audioPlayback = {
        key: "",
        status: "idle",
      };
    }
  }
}

function pauseActiveMessageAudio(audioKey) {
  if (activeMessageAudio?.key !== audioKey || !activeMessageAudio.audio) {
    return false;
  }
  activeMessageAudio.paused = true;
  activeMessageAudio.audio.pause();
  setAudioPlaybackStatus(audioKey, "paused");
  return true;
}

function resumeActiveMessageAudio(audioKey) {
  if (activeMessageAudio?.key !== audioKey || !activeMessageAudio.audio) {
    return null;
  }
  const playback = activeMessageAudio;
  playback.paused = false;
  state.audioPlayback = {
    key: audioKey,
    status: "loading",
  };
  let playPromise;
  try {
    playPromise = playback.audio.play();
  } catch (error) {
    return Promise.reject(error);
  }
  renderAll();
  return Promise.resolve(playPromise).then(() => {
    if (!playback.stopped && activeMessageAudio === playback) {
      setAudioPlaybackStatus(audioKey, "playing");
    }
    return true;
  });
}

function audioPlaybackBaseErrorMessage(error = null, audio = null) {
  const name = String(error?.name || "").trim();
  const message = String(error?.message || "").trim();
  const mediaCode = audio?.error?.code;
  if (name === "NotAllowedError") {
    return "Audio is ready. Tap the speaker again to play it.";
  }
  if (name === "AbortError" || mediaCode === 1) {
    return "Audio playback was aborted.";
  }
  if (name === "NetworkError" || mediaCode === 2) {
    return "Audio network request failed.";
  }
  if (name === "EncodingError" || name === "DecodeError" || mediaCode === 3) {
    return "Browser could not decode the generated audio.";
  }
  if (name === "NotSupportedError" || mediaCode === 4) {
    return "Browser does not support this audio source.";
  }
  if (/did not start/iu.test(message)) {
    return message;
  }
  return message || "Audio playback failed.";
}

function compactAudioDiagnosticText(value = "") {
  return String(value || "")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 180);
}

async function diagnosticFetchAudioUrl(url) {
  if (!url) {
    return "";
  }
  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: {
        accept: "audio/*",
        range: "bytes=0-0",
      },
    });
    if (!response.ok) {
      const detail = compactAudioDiagnosticText(await response.text().catch(() => ""));
      return `Audio endpoint returned HTTP ${response.status}${detail ? `: ${detail}` : "."}`;
    }
    const contentType = String(response.headers.get("content-type") || "").trim();
    if (contentType && !contentType.toLowerCase().startsWith("audio/")) {
      return `Audio endpoint returned ${contentType}, not audio.`;
    }
  } catch (error) {
    return `Audio endpoint check failed: ${error.message || "request failed"}.`;
  }
  return "";
}

async function enrichAudioPlaybackError(error, { audio = null, url = "", diagnose = false } = {}) {
  const base = audioPlaybackBaseErrorMessage(error, audio);
  const diagnostic = diagnose ? await diagnosticFetchAudioUrl(url) : "";
  const enriched = new Error(diagnostic ? `${base} ${diagnostic}` : base);
  try {
    enriched.cause = error;
  } catch (_error) {
    // Older browsers may not allow assigning cause.
  }
  return enriched;
}

function playAudioElement(audioKey, playback, url) {
  return new Promise((resolve, reject) => {
    const audio = playback.audio;
    let settled = false;
    let settlingError = false;
    let started = false;
    let startTimer = null;
    let cleanup = () => {
      if (startTimer) {
        window.clearTimeout(startTimer);
        startTimer = null;
      }
      if (playback.finishCurrent === finishCurrent) {
        playback.finishCurrent = null;
      }
    };
    const settle = (error = null) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    };
    const settleWithError = (error, { diagnose = false } = {}) => {
      if (settled || settlingError) {
        return;
      }
      settlingError = true;
      void enrichAudioPlaybackError(error, { audio, url, diagnose })
        .then((enriched) => {
          if (playback.stopped) {
            settle();
            return;
          }
          settle(enriched);
        });
    };
    const finishCurrent = () => {
      settle();
    };
    playback.finishCurrent = finishCurrent;
    const onEnded = () => {
      settle();
    };
    const onPlaying = () => {
      started = true;
      if (!playback.stopped && activeMessageAudio === playback) {
        setAudioPlaybackStatus(audioKey, "playing");
      }
    };
    const onError = () => {
      if (playback.stopped) {
        settle();
        return;
      }
      settleWithError(new Error("Audio element error"), { diagnose: true });
    };
    cleanup = () => {
      if (startTimer) {
        window.clearTimeout(startTimer);
        startTimer = null;
      }
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
      audio.removeEventListener("playing", onPlaying);
      if (playback.finishCurrent === finishCurrent) {
        playback.finishCurrent = null;
      }
    };
    audio.addEventListener("ended", onEnded, { once: true });
    audio.addEventListener("error", onError, { once: true });
    audio.addEventListener("playing", onPlaying, { once: true });
    audio.preload = "auto";
    audio.volume = 1;
    audio.src = url;
    audio.load();
    let playPromise;
    try {
      playPromise = audio.play();
    } catch (error) {
      settleWithError(error, { diagnose: false });
      return;
    }
    startTimer = window.setTimeout(() => {
      if (!settled && !started && !playback.stopped) {
        settleWithError(new Error("Audio playback did not start. Tap play again."));
      }
    }, audioPlaybackStartTimeoutMs);
    if (playPromise && typeof playPromise.then === "function") {
      playPromise
        .then(() => {
          started = true;
          if (!playback.stopped && activeMessageAudio === playback) {
            setAudioPlaybackStatus(audioKey, "playing");
          }
        })
        .catch((error) => {
          if (playback.stopped) {
            settle();
            return;
          }
          settleWithError(error, { diagnose: false });
        });
    } else {
      started = true;
      if (!playback.stopped && activeMessageAudio === playback) {
        setAudioPlaybackStatus(audioKey, "playing");
      }
    }
  });
}

async function playAudioParts(audioKey, parts, playback = null) {
  playback = playback?.key === audioKey && !playback.stopped
    ? playback
    : reserveMessageAudioPlayback(audioKey);
  activeMessageAudio = playback;

  for (const part of parts) {
    if (activeMessageAudio !== playback || playback.stopped) {
      return;
    }
    await playAudioElement(audioKey, playback, part.url);
  }
}

function startReadyMessageAudioPlayback(audioKey, parts) {
  if (!Array.isArray(parts) || parts.length === 0) {
    return Promise.resolve(false);
  }
  const playback =
    activeMessageAudio?.key === audioKey && !activeMessageAudio.stopped
      ? activeMessageAudio
      : reserveMessageAudioPlayback(audioKey);
  activeMessageAudio = playback;
  state.audioPlayback = {
    key: audioKey,
    status: "loading",
  };
  setAudioAvailability(audioKey, { playbackError: "" }, { render: false });
  const playbackPromise = playAudioParts(audioKey, parts, playback);
  renderAll();
  return playbackPromise.finally(() => {
    if (state.audioPlayback.key === audioKey && state.audioPlayback.status !== "paused") {
      setAudioPlaybackStatus("", "idle");
    }
    if (activeMessageAudio === playback && playback.stopped) {
      activeMessageAudio = null;
    } else if (activeMessageAudio === playback && state.audioPlayback.key !== audioKey) {
      activeMessageAudio = null;
    }
  });
}

function waitForClickPreparedAudioPoll(delayMs = ttsClickPreparePollMs) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, delayMs);
  });
}

async function prepareMessageAudioPartsForPlayback(audioKey, payload) {
  const startedAt = Date.now();
  let poll = false;
  while (Date.now() - startedAt <= ttsClickPrepareTimeoutMs) {
    await prepareMessageAudio(audioKey, payload, {
      background: poll,
      poll,
    });
    const parts = audioPartsFromAvailability(audioKey);
    if (parts.length > 0) {
      return parts;
    }
    const availability = audioAvailability(audioKey);
    if (["error", "unavailable"].includes(availability.status)) {
      return [];
    }
    await waitForClickPreparedAudioPoll();
    poll = true;
  }
  throw new Error("Audio is still preparing. Tap the speaker again in a moment.");
}

async function prepareAndPlayMessageAudio(audioKey, payload) {
  const existingPromise = audioPreparePlaybackPromises.get(audioKey);
  if (existingPromise) {
    showAudioStatus("Preparing audio");
    return existingPromise;
  }
  const promise = (async () => {
    showAudioStatus("Preparing audio");
    const parts = await prepareMessageAudioPartsForPlayback(audioKey, payload);
    if (parts.length > 0) {
      showAudioStatus("Starting audio");
      return startReadyMessageAudioPlayback(audioKey, parts);
    }

    const availability = audioAvailability(audioKey);
    const message =
      availability.error ||
      ttsUnavailableMessage({ available: false, errorCode: availability.errorCode }) ||
      "Audio is not available yet.";
    showAudioStatus(message);
    return false;
  })().finally(() => {
    if (audioPreparePlaybackPromises.get(audioKey) === promise) {
      audioPreparePlaybackPromises.delete(audioKey);
    }
  });
  audioPreparePlaybackPromises.set(audioKey, promise);
  return promise;
}

function playMessageAudio(audioKey, payload) {
  const status = audioPlaybackStatus(audioKey);
  if (status === "loading") {
    stopActiveMessageAudio({ render: false });
    const parts = audioPartsFromAvailability(audioKey);
    if (parts.length > 0) {
      return startReadyMessageAudioPlayback(audioKey, parts);
    }
    return prepareAndPlayMessageAudio(audioKey, payload);
  }
  if (status === "playing") {
    pauseActiveMessageAudio(audioKey);
    return Promise.resolve(true);
  }
  if (status === "paused") {
    return resumeActiveMessageAudio(audioKey) || Promise.resolve(false);
  }

  const parts = audioPartsFromAvailability(audioKey);
  if (parts.length > 0) {
    return startReadyMessageAudioPlayback(audioKey, parts);
  }
  return prepareAndPlayMessageAudio(audioKey, payload);
}

function handleMessageAudioPlaybackError(audioKey, error) {
  const message = audioPlaybackBaseErrorMessage(error) || "Audio playback failed.";
  const ready = audioPartsFromAvailability(audioKey).length > 0;
  const current = audioAvailability(audioKey);
  setAudioAvailability(audioKey, {
    status: ready ? "ready" : "error",
    audio: ready ? current.audio : current.audio || null,
    error: ready ? current.error || "" : message,
    playbackError: message,
  }, { render: false });
  stopActiveMessageAudio({ render: false });
  showAudioStatus(message);
  renderAll();
}

function buildAudioButton({ audioKey, label, payload }) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "copy-button copy-button-floating message-audio-button";
  button.dataset.audioKey = audioKey;
  button.dataset.audioAction = "tts";
  button.dataset.audioPlayLabel = label || "Play audio";
  button.dataset.audioPrepareLabel = String(label || "Play audio").replace(/^Play\b/u, "Prepare local audio and play");
  button.setAttribute("aria-label", label);
  decorateAudioButton(button, audioKey);
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const status = audioPlaybackStatus(audioKey);
    if (status === "loading") {
      return;
    }
    const availability = audioAvailability(audioKey);
    if (
      availability.status === "unavailable" &&
      audioPartsFromAvailability(audioKey).length === 0
    ) {
      showAudioStatus(availability.error || ttsUnavailableMessage() || "Text-to-speech is unavailable.");
      return;
    }
    primeMessageAudioPlayback(audioKey);
    const playbackPromise = playMessageAudio(audioKey, payload);
    if (playbackPromise && typeof playbackPromise.catch === "function") {
      void playbackPromise.catch((error) => {
        handleMessageAudioPlaybackError(audioKey, error);
      });
    }
  });
  return button;
}

function decorateAudioStopButton(button, audioKey) {
  const active = ["playing", "paused"].includes(audioPlaybackStatus(audioKey));
  button.hidden = !active;
  button.disabled = !active;
  button.innerHTML = stopAudioIconMarkup();
  button.setAttribute("aria-label", "Stop audio");
  button.title = "Stop audio";
}

function buildAudioStopButton({ audioKey }) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "copy-button copy-button-floating message-audio-stop-button";
  button.dataset.audioKey = audioKey;
  decorateAudioStopButton(button, audioKey);
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    stopActiveMessageAudio();
  });
  return button;
}

function buildAudioControls(options) {
  const fragment = document.createDocumentFragment();
  fragment.append(buildAudioButton(options));
  fragment.append(buildAudioStopButton({ audioKey: options.audioKey }));
  return fragment;
}

function refreshCopyButtons(root = document) {
  for (const button of root.querySelectorAll(".copy-button[data-copy-key]")) {
    decorateCopyButton(button, button.dataset.copyKey || "");
  }
  for (const button of root.querySelectorAll(".message-audio-button[data-audio-key]")) {
    decorateAudioButton(button, button.dataset.audioKey || "");
  }
  for (const button of root.querySelectorAll(".message-audio-stop-button[data-audio-key]")) {
    decorateAudioStopButton(button, button.dataset.audioKey || "");
  }
  for (const button of root.querySelectorAll(".open-terminal-button[data-terminal-launch-key]")) {
    decorateOpenTerminalButton(button, button.dataset.terminalLaunchKey || "");
  }
}

function projectOptionLabel(project) {
  return project?.displayName || project?.slug || project?.path || "Project";
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
  const scratchpad = [];
  const rootGroups = new Map();
  const pinned = [];

  for (const project of state.projects) {
    if (project?.specialRole === "scratchpad") {
      scratchpad.push(project);
      continue;
    }

    const rootPath = project.workspaceRootPath || workspaceRootForProjectPath(project.path)?.path || "";
    const rootLabel = project.workspaceRootLabel || workspaceRootForProjectPath(project.path)?.label || rootPath;
    if (!rootPath) {
      pinned.push(project);
      continue;
    }

    const group = rootGroups.get(rootPath) || {
      path: rootPath,
      label: rootLabel,
      projects: [],
    };
    group.projects.push(project);
    rootGroups.set(rootPath, group);
  }

  return {
    scratchpad: scratchpad.sort(compareProjects),
    roots: [...rootGroups.values()]
      .sort((left, right) => {
        const leftPrimary = state.workspace?.primaryRoot && left.path === state.workspace.primaryRoot;
        const rightPrimary = state.workspace?.primaryRoot && right.path === state.workspace.primaryRoot;
        if (leftPrimary !== rightPrimary) {
          return leftPrimary ? -1 : 1;
        }
        return left.label.localeCompare(right.label);
      })
      .map((group) => ({
        ...group,
        projects: group.projects.sort(compareProjects),
      })),
    pinned: pinned.sort(compareProjects),
  };
}

function projectPickerGroups() {
  const query = state.projectPickerQuery.trim().toLowerCase();
  const matches = (project) => {
    if (!query) {
      return true;
    }
    return [projectOptionLabel(project), project?.path]
      .some((value) => String(value || "").toLowerCase().includes(query));
  };
  const grouped = groupedProjectOptions();
  return [
    ...(grouped.scratchpad.some(matches)
      ? [{ key: "scratchpad", label: "Scratchpad", projects: grouped.scratchpad.filter(matches) }]
      : []),
    ...grouped.roots
      .map((group) => ({ key: group.path, label: group.label || group.path, projects: group.projects.filter(matches) }))
      .filter((group) => group.projects.length > 0),
    ...(grouped.pinned.some(matches)
      ? [{ key: "pinned", label: "Pinned Projects", projects: grouped.pinned.filter(matches) }]
      : []),
  ];
}

function buildProjectPickerOption(project) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "project-picker-option";
  button.dataset.projectPath = project.path;
  const selected = project.path === state.selectedProject;
  button.classList.toggle("is-selected", selected);
  button.setAttribute("aria-current", selected ? "true" : "false");
  button.setAttribute("aria-label", `Open ${projectOptionLabel(project)}`);

  const icon = document.createElement("span");
  icon.className = "project-picker-option-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.innerHTML = '<svg viewBox="0 0 18 18" fill="none"><path d="M2.75 5.25h4.4l1.15 1.2h6.95v6.8a1.5 1.5 0 0 1-1.5 1.5h-11a1.5 1.5 0 0 1-1.5-1.5v-6.5a1.5 1.5 0 0 1 1.5-1.5Z" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"></path></svg>';

  const copy = document.createElement("span");
  copy.className = "project-picker-option-copy";
  const name = document.createElement("span");
  name.className = "project-picker-option-name";
  name.textContent = projectOptionLabel(project);
  const path = document.createElement("span");
  path.className = "project-picker-option-path";
  path.textContent = project.path;
  copy.append(name, path);

  const check = document.createElement("span");
  check.className = "project-picker-option-check";
  check.setAttribute("aria-hidden", "true");
  check.textContent = selected ? "✓" : "";
  button.append(icon, copy, check);
  button.addEventListener("click", () => {
    closeProjectPicker({ restoreFocus: false });
    void selectProjectPath(project.path).finally(() => {
      window.requestAnimationFrame(() => elements.projectPickerButton?.focus());
    });
  });
  return button;
}

function renderProjectPickerModal() {
  if (!elements.projectPickerModal) {
    return;
  }
  elements.projectPickerModal.hidden = !state.projectPickerOpen;
  if (!state.projectPickerOpen) {
    return;
  }

  const groups = projectPickerGroups();
  const matchCount = groups.reduce((count, group) => count + group.projects.length, 0);
  setText(elements.projectPickerCount, `${matchCount} available`, { empty: false });
  if (elements.projectPickerSearchInput.value !== state.projectPickerQuery) {
    elements.projectPickerSearchInput.value = state.projectPickerQuery;
  }
  elements.projectPickerSearchInput.disabled = catalogBlocksInteraction();
  elements.projectPickerAddExistingButton.disabled =
    catalogBlocksInteraction() || Boolean(state.workspace?.setupRequired);

  clearNode(elements.projectPickerList);
  if (groups.length === 0) {
    const empty = document.createElement("div");
    empty.className = "project-picker-empty";
    empty.textContent = state.projectPickerQuery ? "No matching projects" : "No projects available";
    elements.projectPickerList.append(empty);
    return;
  }

  for (const group of groups) {
    const section = document.createElement("section");
    section.className = "project-picker-group";
    const heading = document.createElement("div");
    heading.className = "project-picker-group-title";
    heading.textContent = group.label;
    const list = document.createElement("div");
    list.className = "project-picker-group-list";
    for (const project of group.projects) {
      list.append(buildProjectPickerOption(project));
    }
    section.append(heading, list);
    elements.projectPickerList.append(section);
  }
}

function renderProjectOptions() {
  if (controlInteractionLocked("project-select")) {
    return;
  }
  const setupRequired = Boolean(state.workspace?.setupRequired);
  const catalogBlocking = catalogBlocksInteraction();
  const disabled = setupRequired || state.dispatchPending || catalogBlocking;
  const renderKey = JSON.stringify({
    disabled,
    setupRequired,
    loading: catalogBlocking,
    selectedProject: state.selectedProject,
    workspace: [
      state.workspace?.setupRequired ? 1 : 0,
      state.workspace?.primaryRoot || "",
      ...(state.workspace?.roots || []).map((root) => `${root.path}:${root.label}`),
    ],
    projects: state.projects.map((project) => [
      project.path,
      project.displayName || project.slug || project.path,
      Number(Boolean(project.featured)),
      project.specialRole || "",
      project.workspaceRootPath || "",
      Number(Boolean(project.untracked)),
      projectDelegateStatusKey(project),
      projectActivityTimestampMs(project),
    ]),
  });
  if (elements.projectPickerButton?.dataset.renderKey === renderKey) {
    return;
  }
  elements.projectSelect.innerHTML = "";
  if (elements.projectAddButton) {
    elements.projectAddButton.disabled = setupRequired || state.projectModalPending;
    elements.projectAddButton.title = setupRequired
      ? "Choose a projects folder first"
      : "Create project directory";
  }

  if (catalogBlocking) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "Loading projects…";
    elements.projectSelect.append(option);
    elements.projectSelect.disabled = true;
    elements.projectSelect.dataset.renderKey = renderKey;
    elements.projectPickerButton.disabled = true;
    setText(elements.projectPickerButtonTitle, "Loading projects…", { empty: false });
    setText(elements.projectPickerButtonSubtitle, "Refreshing your workspace", { empty: false });
    elements.projectPickerButton.dataset.renderKey = renderKey;
    return;
  }

  if (state.projects.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = setupRequired ? "Choose projects folder" : "No projects";
    elements.projectSelect.append(option);
    elements.projectSelect.disabled = true;
    elements.projectSelect.dataset.renderKey = renderKey;
    elements.projectPickerButton.disabled = true;
    setText(
      elements.projectPickerButtonTitle,
      setupRequired ? "Choose projects folder" : "No projects",
      { empty: false },
    );
    setText(
      elements.projectPickerButtonSubtitle,
      setupRequired ? "Set up your workspace first" : "Create a project directory to begin",
      { empty: false },
    );
    elements.projectPickerButton.dataset.renderKey = renderKey;
    return;
  }

  const projectGroups = groupedProjectOptions();
  for (const project of projectGroups.scratchpad) {
    appendProjectOption(elements.projectSelect, project);
  }
  for (const group of projectGroups.roots) {
    appendProjectOptionGroup(group.label, group.projects);
  }
  appendProjectOptionGroup("Pinned Projects", projectGroups.pinned);

  elements.projectSelect.disabled = disabled;
  elements.projectSelect.value = state.selectedProject;
  elements.projectSelect.dataset.renderKey = renderKey;
  const selectedProject = currentProject();
  elements.projectPickerButton.disabled = disabled;
  elements.projectPickerButton.setAttribute(
    "aria-label",
    selectedProject ? `Choose project. Current project ${projectOptionLabel(selectedProject)}` : "Choose project",
  );
  setText(elements.projectPickerButtonTitle, projectOptionLabel(selectedProject), { empty: false });
  setText(elements.projectPickerButtonSubtitle, selectedProject?.path || "Choose a project", { empty: false });
  elements.projectPickerButton.dataset.renderKey = renderKey;
}

function renderWorkspaceSetup() {
  if (!elements.workspaceSetupPanel) {
    return;
  }

  const setupRequired = Boolean(state.workspace?.setupRequired);
  elements.workspaceSetupPanel.hidden = !setupRequired;
  if (!setupRequired) {
    return;
  }

  if (elements.workspaceRootInput && elements.workspaceRootInput.value !== state.workspaceSetupDraft) {
    elements.workspaceRootInput.value = state.workspaceSetupDraft;
  }
  if (elements.workspaceRootInput) {
    elements.workspaceRootInput.disabled = state.workspaceSetupPending || Boolean(state.directoryPickerPending);
  }
  if (elements.workspaceRootChooseButton) {
    const isChoosing = state.directoryPickerPending === "setup";
    elements.workspaceRootChooseButton.disabled =
      state.workspaceSetupPending || Boolean(state.directoryPickerPending);
    elements.workspaceRootChooseButton.querySelector(".button-text").textContent =
      isChoosing ? "Opening..." : "Browse";
  }
  if (elements.workspaceSetupSaveButton) {
    elements.workspaceSetupSaveButton.disabled =
      state.workspaceSetupPending || Boolean(state.directoryPickerPending) || !state.workspaceSetupDraft.trim();
  }

  const status = state.workspaceSetupStatus ||
    (state.workspace?.suggestions?.length
      ? `Try ${state.workspace.suggestions[0]}`
      : "");
  setText(elements.workspaceSetupState, status, { empty: !status });
}

function settingsWorkspaceRootDrafts() {
  return normalizeWorkspaceRootDrafts(state.settingsWorkspaceRootDrafts);
}

function buildSettingsRootRow(rootPath) {
  const isFocus = rootPath === state.settingsWorkspaceFocusDraft;
  const row = document.createElement("div");
  row.className = "settings-root-row";

  const main = document.createElement("div");
  main.className = "settings-root-main";

  const pathLabel = document.createElement("div");
  pathLabel.className = "settings-root-path";
  pathLabel.textContent = rootPath;

  const meta = document.createElement("div");
  meta.className = "settings-root-meta";
  meta.textContent = isFocus ? "Project folder + Scratchpad focus" : "Project folder";

  main.append(pathLabel, meta);

  const actions = document.createElement("div");
  actions.className = "settings-root-actions";

  if (!isFocus) {
    const focusButton = document.createElement("button");
    focusButton.className = "detail-action-button";
    focusButton.type = "button";
    focusButton.textContent = "Set as Scratchpad";
    focusButton.disabled = state.settingsWorkspacePending;
    focusButton.addEventListener("click", () => {
      state.settingsWorkspaceFocusDraft = rootPath;
      state.settingsWorkspaceStatus = "";
      renderAll();
    });
    actions.append(focusButton);
  }

  const removeButton = document.createElement("button");
  removeButton.className = "detail-action-button is-quiet";
  removeButton.type = "button";
  removeButton.textContent = "Remove";
  removeButton.disabled = state.settingsWorkspacePending;
  removeButton.addEventListener("click", () => {
    state.settingsWorkspaceRootDrafts = state.settingsWorkspaceRootDrafts
      .filter((entry) => entry !== rootPath);
    state.settingsWorkspaceStatus = "";
    renderAll();
  });
  actions.append(removeButton);

  row.append(main, actions);
  return row;
}

function renderCloudDevices() {
  if (!elements.settingsPairedDevices) {
    return;
  }
  clearNode(elements.settingsPairedDevices);
  if (state.cloudDevicesPending) {
    const status = document.createElement("div");
    status.className = "settings-device-empty";
    status.textContent = "Checking paired devices...";
    elements.settingsPairedDevices.append(status);
    return;
  }
  if (state.cloudDevicesStatus) {
    const status = document.createElement("div");
    status.className = "settings-device-empty";
    status.textContent = state.cloudDevicesStatus;
    elements.settingsPairedDevices.append(status);
    return;
  }
  if (state.cloudDevices.length === 0) {
    const empty = document.createElement("div");
    empty.className = "settings-device-empty";
    empty.textContent = "No devices are paired yet.";
    elements.settingsPairedDevices.append(empty);
    return;
  }

  for (const device of state.cloudDevices) {
    const row = document.createElement("div");
    row.className = "settings-device-row";
    const details = document.createElement("div");
    details.className = "settings-device-details";
    const name = document.createElement("div");
    name.className = "settings-root-path";
    name.textContent = String(device.deviceName || device.deviceId || "ClawDad device");
    const meta = document.createElement("div");
    meta.className = "settings-root-meta";
    const seenAt = formatTimestamp(device.lastSeenAt || device.trustedAt);
    meta.textContent = seenAt ? `Last connected ${seenAt}` : "Paired device";
    details.append(name, meta);

    const revoke = document.createElement("button");
    revoke.className = "settings-inline-info-button is-danger";
    revoke.type = "button";
    revoke.textContent = "Forget";
    revoke.disabled = state.cloudDevicesPending;
    revoke.addEventListener("click", () => {
      void forgetCloudDevice(device.deviceId);
    });
    row.append(details, revoke);
    elements.settingsPairedDevices.append(row);
  }
}

function applyRemoteComputersStatus(value) {
  const status = value && typeof value === "object" ? value : {};
  state.remoteComputers = Array.isArray(status.computers) ? status.computers : [];
  if (status.state && !state.remoteComputersPending) {
    state.remoteComputersStatus = String(status.state) === "Disconnected"
      ? ""
      : String(status.state);
  }
}

function renderRemoteComputers() {
  const section = elements.settingsRemoteComputersSection;
  if (!section) {
    return;
  }
  const available = nativeBridge.isAvailable() &&
    state.desktopAppStatus?.platform === "macos";
  section.hidden = !available;
  if (!available) {
    return;
  }

  elements.settingsRemotePairingForm.hidden = !state.remotePairingOpen;
  if (elements.settingsRemotePairingCode.value !== state.remotePairingCode) {
    elements.settingsRemotePairingCode.value = state.remotePairingCode;
  }
  elements.settingsRemotePairingCode.disabled = state.remoteComputersPending;
  elements.settingsRemotePairingSubmit.disabled =
    state.remoteComputersPending || !state.remotePairingCode.trim();
  elements.settingsRemotePairingCancel.disabled = state.remoteComputersPending;
  elements.settingsPairRemoteComputerButton.disabled = state.remoteComputersPending;
  setText(
    elements.settingsPairRemoteComputerButton.querySelector(".button-text"),
    state.remotePairingOpen ? "Pairing Code" : "Pair a Mac",
  );
  setText(
    elements.settingsRemotePairingSubmit.querySelector(".button-text"),
    state.remoteComputersPending ? "Pairing..." : "Pair Securely",
  );
  setText(elements.settingsRemoteComputersStatus, state.remoteComputersStatus, {
    empty: !state.remoteComputersStatus,
  });

  clearNode(elements.settingsRemoteComputersList);
  if (state.remoteComputersPending && state.remoteComputers.length === 0) {
    const pending = document.createElement("div");
    pending.className = "settings-device-empty";
    pending.textContent = "Checking paired computers...";
    elements.settingsRemoteComputersList.append(pending);
    return;
  }
  if (state.remoteComputers.length === 0) {
    const empty = document.createElement("div");
    empty.className = "settings-device-empty";
    empty.textContent = "No remote computers are paired with this Mac yet.";
    elements.settingsRemoteComputersList.append(empty);
    return;
  }

  for (const computer of state.remoteComputers) {
    const row = document.createElement("div");
    row.className = "settings-device-row";
    const details = document.createElement("div");
    details.className = "settings-device-details";
    const name = document.createElement("div");
    name.className = "settings-root-path";
    name.textContent = String(computer.displayName || computer.hostId || "Paired Mac");
    const meta = document.createElement("div");
    meta.className = "settings-root-meta";
    const pairedAt = formatTimestamp(computer.pairedAt);
    meta.textContent = pairedAt ? `Paired ${pairedAt}` : "Securely paired";
    details.append(name, meta);

    const actions = document.createElement("div");
    actions.className = "settings-device-actions";
    const open = document.createElement("button");
    open.className = "detail-action-button settings-picker-button";
    open.type = "button";
    open.textContent = "Open Remote Assist";
    open.disabled = state.remoteComputersPending || computer.supportsRemoteAssist === false;
    open.addEventListener("click", () => {
      void openRemoteComputer(computer.id);
    });
    const forget = document.createElement("button");
    forget.className = "settings-inline-info-button is-danger";
    forget.type = "button";
    forget.textContent = "Forget";
    forget.disabled = state.remoteComputersPending;
    forget.addEventListener("click", () => {
      void forgetRemoteComputer(computer.id);
    });
    actions.append(open, forget);
    row.append(details, actions);
    elements.settingsRemoteComputersList.append(row);
  }
}

function renderSettingsModal() {
  if (!elements.settingsModal) {
    return;
  }
  if (!state.settingsModalOpen) {
    elements.settingsModal.hidden = true;
    return;
  }

  const roots = settingsWorkspaceRootDrafts();
  elements.settingsModal.hidden = false;
  setText(elements.settingsState, state.settingsWorkspaceStatus, {
    empty: !state.settingsWorkspaceStatus,
  });

  if (elements.settingsScratchpadInput.value !== state.settingsWorkspaceFocusDraft) {
    elements.settingsScratchpadInput.value = state.settingsWorkspaceFocusDraft;
  }
  elements.settingsScratchpadInput.disabled =
    state.settingsWorkspacePending || Boolean(state.directoryPickerPending);
  if (elements.settingsScratchpadChooseButton) {
    const isChoosing = state.directoryPickerPending === "scratchpad";
    elements.settingsScratchpadChooseButton.disabled =
      state.settingsWorkspacePending || Boolean(state.directoryPickerPending);
    elements.settingsScratchpadChooseButton.querySelector(".button-text").textContent =
      isChoosing ? "Opening..." : "Browse";
  }

  clearNode(elements.settingsProjectRootsList);
  if (roots.length === 0) {
    const empty = document.createElement("div");
    empty.className = "settings-root-row";
    const main = document.createElement("div");
    main.className = "settings-root-main";
    const pathLabel = document.createElement("div");
    pathLabel.className = "settings-root-path";
    pathLabel.textContent = "No project folders";
    main.append(pathLabel);
    empty.append(main);
    elements.settingsProjectRootsList.append(empty);
  } else {
    for (const rootPath of roots) {
      elements.settingsProjectRootsList.append(buildSettingsRootRow(rootPath));
    }
  }

  if (elements.settingsNewRootInput.value !== state.settingsWorkspaceNewRootDraft) {
    elements.settingsNewRootInput.value = state.settingsWorkspaceNewRootDraft;
  }
  elements.settingsNewRootInput.disabled =
    state.settingsWorkspacePending || Boolean(state.directoryPickerPending);
  const newRoot = state.settingsWorkspaceNewRootDraft.trim();
  elements.settingsAddRootButton.disabled =
    state.settingsWorkspacePending || Boolean(state.directoryPickerPending) || !newRoot || roots.includes(newRoot);
  if (elements.settingsChooseRootButton) {
    const isChoosing = state.directoryPickerPending === "project-root";
    elements.settingsChooseRootButton.disabled =
      state.settingsWorkspacePending || Boolean(state.directoryPickerPending);
    elements.settingsChooseRootButton.querySelector(".button-text").textContent =
      isChoosing ? "Opening..." : "Browse Folders";
  }
  renderVoiceSettings();
  renderDesktopAppSettings();
  renderRemoteAssistSettings();
  if (elements.settingsPairIphoneButton) {
    elements.settingsPairIphoneButton.disabled =
      state.settingsWorkspacePending || state.cloudPairingPending || Boolean(state.directoryPickerPending);
    elements.settingsPairIphoneButton.querySelector(".button-text").textContent =
      state.cloudPairingPending ? "Generating..." : "Allow a Device";
  }
  if (elements.settingsPairingStatus) {
    setText(elements.settingsPairingStatus, state.cloudPairingStatus, {
      empty: !state.cloudPairingStatus,
    });
  }
  if (elements.settingsPairingQr) {
    elements.settingsPairingQr.hidden = !state.cloudPairingQrSvg;
    if (state.cloudPairingQrSvg && elements.settingsPairingQr.innerHTML !== state.cloudPairingQrSvg) {
      elements.settingsPairingQr.innerHTML = state.cloudPairingQrSvg;
    } else if (!state.cloudPairingQrSvg) {
      clearNode(elements.settingsPairingQr);
    }
  }
  if (elements.settingsPairingExpiry) {
    const expiresAtMs = Date.parse(state.cloudPairingExpiresAt || "");
    const expiryText = Number.isFinite(expiresAtMs)
      ? `Expires ${new Date(expiresAtMs).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
      : "";
    setText(elements.settingsPairingExpiry, expiryText, { empty: !expiryText });
  }
  if (elements.settingsCopyPairingCodeButton) {
    elements.settingsCopyPairingCodeButton.hidden = !state.cloudPairingCode;
    elements.settingsCopyPairingCodeButton.disabled = state.cloudPairingPending;
  }
  if (elements.settingsRefreshDevicesButton) {
    elements.settingsRefreshDevicesButton.disabled = state.cloudDevicesPending;
    elements.settingsRefreshDevicesButton.querySelector(".button-text").textContent =
      state.cloudDevicesPending ? "Checking..." : "Refresh";
  }
  renderCloudDevices();
  renderRemoteComputers();
  elements.settingsCancelButton.disabled =
    state.settingsWorkspacePending || Boolean(state.directoryPickerPending);
  elements.settingsSaveButton.disabled =
    state.settingsWorkspacePending || Boolean(state.directoryPickerPending) || !state.settingsWorkspaceFocusDraft.trim();
  elements.settingsSaveButton.querySelector(".button-text").textContent =
    state.settingsWorkspacePending ? "Saving…" : "Save";
}

function directoryBrowserTitleForPurpose(purpose = state.directoryBrowserPurpose) {
  if (purpose === "scratchpad") {
    return "Choose Scratchpad Focus";
  }
  if (purpose === "setup") {
    return "Choose Projects Folder";
  }
  return "Choose Project Folder";
}

function directoryBrowserFilteredEntries() {
  const query = state.directoryBrowserQuery.trim().toLowerCase();
  if (!query) {
    return state.directoryBrowserEntries;
  }
  return state.directoryBrowserEntries.filter((entry) =>
    String(entry.name || "").toLowerCase().includes(query) ||
    String(entry.path || "").toLowerCase().includes(query),
  );
}

function buildDirectoryBrowserRootButton(root) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "directory-browser-root-button";
  button.textContent = root.label || root.path;
  button.disabled = state.directoryBrowserLoading || root.path === state.directoryBrowserPath;
  button.addEventListener("click", () => {
    void loadDirectoryBrowserPath(root.path);
  });
  return button;
}

function buildDirectoryBrowserEntry(entry) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "directory-browser-entry";
  button.disabled = state.directoryBrowserLoading;

  const name = document.createElement("span");
  name.className = "directory-browser-entry-name";
  name.textContent = entry.name || entry.path;

  const pathLabel = document.createElement("span");
  pathLabel.className = "directory-browser-entry-path";
  pathLabel.textContent = entry.label || entry.path;

  button.append(name, pathLabel);
  button.addEventListener("click", () => {
    void loadDirectoryBrowserPath(entry.path);
  });
  return button;
}

function renderDirectoryBrowserModal() {
  if (!elements.directoryBrowserModal) {
    return;
  }
  if (!state.directoryBrowserOpen) {
    elements.directoryBrowserModal.hidden = true;
    return;
  }

  elements.directoryBrowserModal.hidden = false;
  setText(elements.directoryBrowserTitle, directoryBrowserTitleForPurpose(), { empty: false });
  const stateText = state.directoryBrowserLoading
    ? "Loading folders..."
    : state.directoryBrowserStatus;
  setText(elements.directoryBrowserState, stateText, { empty: !stateText });

  clearNode(elements.directoryBrowserRoots);
  for (const root of state.directoryBrowserRoots) {
    elements.directoryBrowserRoots.append(buildDirectoryBrowserRootButton(root));
  }

  if (elements.directoryBrowserPathInput.value !== state.directoryBrowserPathDraft) {
    elements.directoryBrowserPathInput.value = state.directoryBrowserPathDraft;
  }
  elements.directoryBrowserPathInput.disabled = state.directoryBrowserLoading;
  elements.directoryBrowserGoButton.disabled =
    state.directoryBrowserLoading || !state.directoryBrowserPathDraft.trim();
  elements.directoryBrowserUpButton.disabled =
    state.directoryBrowserLoading || !state.directoryBrowserParent;

  if (elements.directoryBrowserSearchInput.value !== state.directoryBrowserQuery) {
    elements.directoryBrowserSearchInput.value = state.directoryBrowserQuery;
  }
  elements.directoryBrowserSearchInput.disabled = state.directoryBrowserLoading;

  clearNode(elements.directoryBrowserList);
  const entries = directoryBrowserFilteredEntries();
  if (state.directoryBrowserLoading) {
    const loading = document.createElement("div");
    loading.className = "directory-browser-empty";
    loading.textContent = "Loading folders...";
    elements.directoryBrowserList.append(loading);
  } else if (entries.length === 0) {
    const empty = document.createElement("div");
    empty.className = "directory-browser-empty";
    empty.textContent = state.directoryBrowserQuery ? "No matching folders" : "No folders here";
    elements.directoryBrowserList.append(empty);
  } else {
    for (const entry of entries) {
      elements.directoryBrowserList.append(buildDirectoryBrowserEntry(entry));
    }
  }

  elements.directoryBrowserUseButton.disabled =
    state.directoryBrowserLoading || !state.directoryBrowserPath;
  elements.directoryBrowserCancelButton.disabled = false;
}

function updateProjectControlAppearance() {
  const project = currentProject();
  const isFeatured = Boolean(project?.featured);
  const hasLiveDelegates = state.projects.some((entry) => projectHasLiveDelegate(entry));
  const hasActiveRuns = activeDelegateProjects().length > 0;
  const selectedProjectIsLive = projectHasLiveDelegate(project);
  const projectControl = elements.projectPickerButton?.closest(".project-control");

  elements.projectSelect.classList.toggle("is-featured", isFeatured);
  elements.projectSelect.classList.toggle("is-live-delegate", selectedProjectIsLive);
  elements.projectPickerButton?.classList.toggle("is-featured", isFeatured);
  elements.projectPickerButton?.classList.toggle("is-live-delegate", selectedProjectIsLive);
  projectControl?.classList.toggle("is-featured", isFeatured);
  projectControl?.classList.toggle("has-live-delegates", hasLiveDelegates);
  projectControl?.classList.toggle("is-live-delegate", selectedProjectIsLive);
  elements.activeRunsButton?.classList.toggle("has-live-delegates", hasActiveRuns);
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
    state.sessionSwitchPending ||
    state.sessionCreatePending ||
    state.dispatchPending;
  const renderKey = JSON.stringify({
    projectPath: project?.path || "",
    disabled,
    sessionBusy,
    selectedSessionId: state.selectedSessionId,
    sessionCreatePending: state.sessionCreatePending,
    sessions: sessions.map((session) => [
      session.sessionId || "",
      sessionOptionLabel(session, project?.path),
      session.status || "",
      session.lastDispatch || "",
      session.lastResponse || "",
      session.providerLastActivity || "",
      session.providerSessionTimestamp || "",
      session.lastActivityAt || "",
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
    const newOption = document.createElement("option");
    newOption.value = newSessionSelectValue;
    newOption.textContent = state.sessionCreatePending ? "Starting new Codex session…" : "Start new Codex session…";
    elements.sessionSelect.append(newOption);
    elements.sessionSelect.disabled = disabled;
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

  const newOption = document.createElement("option");
  newOption.value = newSessionSelectValue;
  newOption.textContent = state.sessionCreatePending ? "Starting new Codex session…" : "Start new Codex session…";
  elements.sessionSelect.append(newOption);

  elements.sessionControl?.classList.toggle(
    "is-loading",
    sessionBusy || state.sessionCreatePending,
  );
  elements.sessionSelect.disabled = disabled;
  elements.sessionSelect.value = state.selectedSessionId;
  elements.sessionSelect.dataset.renderKey = renderKey;
}

function threadPreviewStatus(thread) {
  const status = String(thread?.status || "").trim();
  if (status) {
    return status.toUpperCase();
  }
  return thread?.active ? "ACTIVE" : String(thread?.provider || "codex").toUpperCase();
}

function threadPreviewDetail(thread) {
  if (thread?.lastResponse) {
    return `Responded ${formatTimestamp(thread.lastResponse) || "recently"}`;
  }
  if (thread?.lastDispatch) {
    return `Sent ${formatTimestamp(thread.lastDispatch) || "recently"}`;
  }
  return "Open the Codex thread";
}

function buildThreadPreviewCard(thread) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "thread-preview-card";
  button.dataset.projectPath = thread.projectPath;
  button.dataset.sessionId = thread.sessionId;
  const selected =
    thread.projectPath === state.selectedProject && thread.sessionId === state.selectedSessionId;
  button.classList.toggle("is-selected", selected);
  button.setAttribute("aria-label", `Open ${thread.title}`);

  const rail = document.createElement("span");
  rail.className = "thread-preview-rail";
  rail.setAttribute("aria-hidden", "true");
  const dot = document.createElement("span");
  dot.className = "thread-preview-dot";
  const line = document.createElement("span");
  line.className = "thread-preview-line";
  rail.append(dot, line);

  const copy = document.createElement("span");
  copy.className = "thread-preview-card-copy";
  const top = document.createElement("span");
  top.className = "thread-preview-card-top";
  const time = document.createElement("span");
  time.className = "thread-preview-time";
  time.textContent = formatTimestamp(thread.lastActivityAt) || "Now";
  const status = document.createElement("span");
  status.className = "thread-preview-status";
  status.textContent = threadPreviewStatus(thread);
  top.append(time, status);

  const title = document.createElement("span");
  title.className = "thread-preview-card-title";
  title.textContent = thread.title || "Codex thread";
  const meta = document.createElement("span");
  meta.className = "thread-preview-card-meta";
  const projectName = document.createElement("span");
  projectName.className = "thread-preview-project";
  projectName.textContent = thread.projectName || fallbackProjectLabel(thread.projectPath);
  const session = document.createElement("span");
  session.className = "thread-preview-session";
  session.textContent = sessionFingerprint(thread.sessionId);
  meta.append(projectName, session);
  const detail = document.createElement("span");
  detail.className = "thread-preview-detail";
  detail.textContent = threadPreviewDetail(thread);
  copy.append(top, title, meta, detail);
  button.append(rail, copy);
  button.addEventListener("click", () => {
    void openSessionThread(thread.projectPath, thread.sessionId).catch(showError);
  });
  return button;
}

function renderThreadPreviewPanel() {
  if (!elements.threadPreviewPanel) {
    return;
  }
  const allScope = state.threadScope === "all";
  const project = currentProject();
  const cards = threadPreviewCards();
  const loading = state.projectsLoading;
  const refreshDisabled =
    catalogBlocksInteraction() || (!allScope && !state.selectedProject);

  elements.threadScopeProjectButton.classList.toggle("is-active", !allScope);
  elements.threadScopeAllButton.classList.toggle("is-active", allScope);
  elements.threadScopeProjectButton.setAttribute("aria-pressed", String(!allScope));
  elements.threadScopeAllButton.setAttribute("aria-pressed", String(allScope));
  elements.threadPreviewRefreshButton.disabled = refreshDisabled;
  const refreshLabel = allScope ? "Refresh all threads" : "Refresh project threads";
  elements.threadPreviewRefreshButton.setAttribute("aria-label", refreshLabel);
  elements.threadPreviewRefreshButton.title = refreshLabel;
  setText(
    elements.threadPreviewSubtitle,
    allScope
      ? "Recent across all projects"
      : project
        ? projectOptionLabel(project)
        : "Recent in this project",
    { empty: false },
  );

  const stateText = state.threadPreviewError
    ? state.threadPreviewError
    : loading && cards.length === 0
      ? "Refreshing threads…"
      : cards.length === 0
        ? allScope
          ? "No Codex threads in your workspace yet."
          : "No Codex threads in this directory yet."
        : "";
  setText(elements.threadPreviewState, stateText, { empty: !stateText });

  const renderKey = JSON.stringify({
    scope: state.threadScope,
    selectedProject: state.selectedProject,
    selectedSessionId: state.selectedSessionId,
    cards: cards.map((thread) => [
      thread.projectPath,
      thread.sessionId,
      thread.title,
      thread.status,
      thread.active,
      thread.lastActivityAt,
      thread.lastDispatch,
      thread.lastResponse,
    ]),
  });
  if (elements.threadPreviewList.dataset.renderKey === renderKey) {
    return;
  }
  clearNode(elements.threadPreviewList);
  for (const thread of cards) {
    elements.threadPreviewList.append(buildThreadPreviewCard(thread));
  }
  elements.threadPreviewList.dataset.renderKey = renderKey;
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
      state.projectPickerOpen ||
      state.projectModalOpen ||
      Boolean(state.summaryModalProject) ||
      Boolean(state.codexIntegrationModalProject) ||
      Boolean(state.activeRunsModalOpen) ||
      Boolean(state.artifactModalProject) ||
      Boolean(state.delegateModalProject) ||
      Boolean(state.sessionTitleModalProject) ||
      Boolean(state.settingsModalOpen) ||
      Boolean(state.directoryBrowserOpen) ||
      systemSetupIsOpen() ||
      terminalPanelIsOpen() ||
      Boolean(state.queueArchiveConfirmEntryId),
  );
}

function projectDirectoryNameIsValid(value) {
  const name = String(value || "").trim();
  return Boolean(
    name &&
    name.length <= 120 &&
    name !== "." &&
    name !== ".." &&
    !name.startsWith(".") &&
    !name.includes("/") &&
    !name.includes("\\") &&
    !/[\u0000-\u001f\u007f]/u.test(name),
  );
}

function renderProjectModal() {
  if (!state.projectModalOpen) {
    elements.projectModal.hidden = true;
    return;
  }

  const creatingNew = state.projectModalMode === "new";
  const roots = state.projectRoots;
  const repos = currentRootRepos();
  const selectedRepo = repos.find((repo) => repo.path === state.projectModalRepoPath) || null;

  setText(elements.projectModalTitle, creatingNew ? "New Project Directory" : "Add Existing Project", { empty: false });
  setText(
    elements.projectModalDescription,
    creatingNew
      ? "Create a folder inside your configured Projects directory, register it with Codex, and select its first thread."
      : "Choose an existing folder from one of your configured project roots and add it to ClawDad.",
    { empty: false },
  );

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
    option.textContent = "No configured roots";
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

  elements.projectRootSelect.hidden = creatingNew;
  elements.projectRepoSelect.hidden = creatingNew;
  elements.projectNameInput.hidden = !creatingNew;
  elements.projectDestination.hidden = !creatingNew;
  setText(
    elements.projectDestinationValue,
    state.projectModalRoot || state.workspace?.primaryRoot || "Configured Projects directory",
    { empty: false },
  );

  elements.projectRepoSelect.innerHTML = "";
  if (!creatingNew) {
    if (!state.projectModalRoot) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "Choose root…";
      elements.projectRepoSelect.append(option);
      elements.projectRepoSelect.disabled = true;
    } else if (repos.length === 0) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "No project folders found";
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

  if (elements.projectNameInput.value !== state.projectModalName) {
    elements.projectNameInput.value = state.projectModalName;
  }
  elements.projectNameInput.disabled = state.projectModalPending || !state.projectModalRoot;
  elements.projectNameInput.setAttribute(
    "aria-invalid",
    String(Boolean(state.projectModalName.trim()) && !projectDirectoryNameIsValid(state.projectModalName)),
  );
  elements.projectProviderSelect.value = state.projectModalProvider;
  elements.projectProviderSelect.disabled = state.projectModalPending;
  elements.projectModeExisting.classList.toggle("is-active", !creatingNew);
  elements.projectModeNew.classList.toggle("is-active", creatingNew);
  elements.projectModalClose.disabled = state.projectModalPending;
  elements.projectModalBackdrop.disabled = state.projectModalPending;

  const canCreate =
    !state.projectModalPending &&
    !state.projectRootsLoading &&
    Boolean(state.projectModalRoot) &&
    (creatingNew
      ? projectDirectoryNameIsValid(state.projectModalName)
      : Boolean(state.projectModalRepoPath));
  elements.projectCreateButton.disabled = !canCreate;
  elements.projectCreateButton.querySelector(".button-text").textContent =
    state.projectModalPending
      ? creatingNew ? "Creating Project…" : "Adding Project…"
      : !creatingNew && selectedRepo?.tracked
        ? "Start New Session"
        : creatingNew
          ? "Create Project"
          : "Add Existing Project";

  let modalState = state.projectModalStatus;
  if (!modalState && !creatingNew && selectedRepo?.tracked) {
    modalState = "This project is already tracked. Continue to start another session.";
  }
  if (!modalState && creatingNew && state.projectModalName.trim() && !projectDirectoryNameIsValid(state.projectModalName)) {
    modalState = "Use one visible folder name without slashes. Names cannot begin with a period.";
  }
  setText(elements.projectModalState, modalState, { empty: !modalState });
  elements.projectModal.hidden = false;
}

function messageAudioKey(entry, kind, text = "") {
  const projectPath = String(entry?.projectPath || "").trim();
  const sessionId = String(entry?.sessionId || "").trim();
  const requestId = String(entry?.requestId || entry?.id || entry?.sentAt || "").trim();
  const fingerprint = messageAudioTextFingerprint(text);
  return `tts:${projectPath}:${sessionId}:${requestId}:${kind}:${fingerprint.colonKey}`;
}

function messageAudioPayload(entry, kind, text) {
  const requestId = String(entry?.requestId || "").trim();
  const fingerprint = messageAudioTextFingerprint(text);
  return {
    project: String(entry?.projectPath || "").trim(),
    sessionId: String(entry?.sessionId || "").trim(),
    requestId: requestId ? `${requestId}:tts:${fingerprint.dashKey}` : `tts:${fingerprint.dashKey}`,
    historyRequestId: requestId,
    kind,
    text: ttsFallbackText(fingerprint.text),
    textCharCount: fingerprint.length,
    clientTextLength: fingerprint.length,
    clientTextHash: fingerprint.hash,
    clientTextKey: fingerprint.dashKey,
  };
}

function historyAudioManifestMatchesVisibleText(manifest, text = "") {
  if (!manifest || typeof manifest !== "object") {
    return false;
  }
  const fingerprint = messageAudioTextFingerprint(text);
  if (!fingerprint.text) {
    return false;
  }
  const source = manifest.source && typeof manifest.source === "object" && !Array.isArray(manifest.source)
    ? manifest.source
    : {};
  const clientHash = String(
    source.clientTextHash ||
      source.visibleTextHash ||
      source.clientVisibleTextHash ||
      "",
  ).trim();
  if (!clientHash || clientHash !== fingerprint.hash) {
    return false;
  }
  const rawLength = source.clientTextLength ?? source.clientTextCharCount ?? source.textCharCount;
  const clientLength = Number.parseInt(String(rawLength ?? ""), 10);
  return !Number.isFinite(clientLength) || clientLength === fingerprint.length;
}

function hydrateAudioAvailabilityFromHistoryItem(item, { render = false } = {}) {
  const normalized = normalizeHistoryItem(item);
  const audio = normalizeHistoryAudioMetadata(normalized.audio);
  if (!audio) {
    return;
  }

  for (const [kind, manifest] of [
    ["message", audio.message],
    ["response", audio.response],
  ]) {
    if (!manifest) {
      continue;
    }
    if (kind === "message" && !String(normalized.message || "").trim()) {
      continue;
    }
    if (kind === "response" && !String(normalized.response || "").trim()) {
      continue;
    }
    if (!String(manifest.textHash || manifest.source?.textHash || "").trim()) {
      continue;
    }
    const text = kind === "response" ? normalized.response : normalized.message;
    if (!historyAudioManifestMatchesVisibleText(manifest, text)) {
      continue;
    }
    const audioKey = messageAudioKey(normalized, kind, text);
    if (audioManifestReady(manifest)) {
      setAudioAvailability(audioKey, {
        status: "ready",
        audio: manifest,
        error: "",
      }, { render });
      continue;
    }

    if (audioManifestFailed(manifest)) {
      const errorCode = manifest.errorCode || ttsErrorCodeFromMessage(manifest.error);
      const unavailable = ttsErrorImpliesUnavailable(errorCode, manifest.error);
      setAudioAvailability(audioKey, {
        status: unavailable ? "unavailable" : "error",
        audio: manifest,
        error: ttsUnavailableMessage({
          available: false,
          errorCode,
          error: manifest.error,
        }) || manifest.error || "Audio is not available. Click to retry.",
        errorCode,
      }, { render });
    }
  }
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
      applyWorkspacePayload(payload.workspace);
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

async function saveWorkspaceSetup() {
  if (state.directoryPickerPending || state.directoryBrowserOpen) {
    return;
  }
  const primaryRoot = state.workspaceSetupDraft.trim();
  if (!primaryRoot) {
    state.workspaceSetupStatus = "Choose a projects folder";
    renderAll();
    return;
  }

  state.workspaceSetupPending = true;
  state.workspaceSetupStatus = "Checking folder…";
  renderAll();
  try {
    const payload = await fetchJson("/v1/workspace", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        primaryRoot,
        projectRoots: [primaryRoot],
      }),
    });
    applyWorkspacePayload(payload.workspace);
    state.workspaceSetupStatus = "";
    state.workspaceSetupDraft = state.workspace?.primaryRoot || primaryRoot;
    await refreshProjectRoots();
    await refreshProjects();
  } catch (error) {
    state.workspaceSetupStatus = error.message;
    showError(error);
  } finally {
    state.workspaceSetupPending = false;
    renderAll();
  }
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
      const params = new URLSearchParams({ project: normalizedProjectPath });
      if (force) {
        params.set("force", "1");
      }
      const payload = await fetchJson(`/v1/importable-sessions?${params.toString()}`);
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
    const status = threadEntryStatus(entry);
    const clickable = Boolean(entry.projectPath && entry.sessionId);
    const unread = entryIsUnread(entry);
    const card = document.createElement("article");
    card.className = `queue-card ${threadEntryIsPending(entry) ? "processing" : status === "answered" ? "done" : "failed"}`;
    card.classList.toggle("is-unread", unread);
    if (clickable) {
      card.classList.add("clickable");
      card.tabIndex = 0;
      card.setAttribute("role", "button");
      card.addEventListener("click", (event) => {
        if (card.dataset.swipeSuppress === "true") {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
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
    chip.className = `queue-chip ${threadEntryIsPending(entry) ? "processing" : status === "answered" ? "done" : "failed"}`;
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
    const attachments = buildMessageAttachmentList(entry.attachments);

    const copyButton = buildCopyButton({
      copyKey: entryCopyKey(entry, "queue-message", entry.message),
      label: "Copy message",
      text: entry.message,
    });

    card.append(copyButton);
    if (canOpenTerminalStream(entry)) {
      card.append(buildTerminalStreamButton(entry));
    }
    card.append(buildQueueArchiveButton(entry));
    card.append(head, meta, message);
    if (attachments) {
      card.append(attachments);
    }

    attachQueueCardArchiveSwipe(card, entry);
    elements.queueList.append(card);
  }
}

function queueArchiveEntryId(entry) {
  return String(entry?.id || entry?.requestId || entry?.sentAt || "").trim();
}

function queueArchiveEntry() {
  const entryId = String(state.queueArchiveConfirmEntryId || "").trim();
  if (!entryId) {
    return null;
  }
  return state.threadEntries.find((entry) => queueArchiveEntryId(entry) === entryId) || null;
}

function buildQueueArchiveButton(entry) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "copy-button copy-button-floating queue-card-archive-button";
  button.setAttribute("aria-label", "Archive worker card");
  button.innerHTML = `
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3.1 5.35h9.8v7.05a1.15 1.15 0 0 1-1.15 1.15h-7.5A1.15 1.15 0 0 1 3.1 12.4V5.35Z" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"></path>
      <path d="M2.35 3.15h11.3v2.2H2.35zM6.15 8h3.7" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"></path>
    </svg>
  `;
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openQueueArchiveConfirm(entry, button);
  });
  return button;
}

function attachQueueCardArchiveSwipe(card, entry) {
  let startX = 0;
  let startY = 0;
  let currentX = 0;
  let pointerId = null;
  let dragging = false;
  let horizontal = false;

  const reset = () => {
    pointerId = null;
    dragging = false;
    horizontal = false;
    card.classList.remove("is-swiping", "is-swipe-armed");
    card.style.removeProperty("--queue-card-swipe-x");
  };

  card.addEventListener("pointerdown", (event) => {
    if (event.button !== undefined && event.button !== 0) {
      return;
    }
    if (event.target instanceof Element && event.target.closest("button, a, input, textarea, select")) {
      return;
    }
    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    currentX = event.clientX;
    dragging = true;
    horizontal = false;
    card.setPointerCapture?.(event.pointerId);
  });

  card.addEventListener("pointermove", (event) => {
    if (!dragging || pointerId !== event.pointerId) {
      return;
    }
    currentX = event.clientX;
    const deltaX = currentX - startX;
    const deltaY = event.clientY - startY;
    if (!horizontal) {
      if (Math.abs(deltaX) < 10) {
        return;
      }
      if (Math.abs(deltaX) <= Math.abs(deltaY) * 1.2) {
        return;
      }
      horizontal = true;
      card.classList.add("is-swiping");
    }
    if (deltaX >= 0) {
      card.style.setProperty("--queue-card-swipe-x", "0px");
      card.classList.remove("is-swipe-armed");
      return;
    }
    event.preventDefault();
    const clamped = Math.max(deltaX, -118);
    card.style.setProperty("--queue-card-swipe-x", `${clamped}px`);
    card.classList.toggle("is-swipe-armed", clamped <= -72);
  });

  card.addEventListener("pointerup", (event) => {
    if (!dragging || pointerId !== event.pointerId) {
      return;
    }
    const deltaX = currentX - startX;
    const shouldArchive = horizontal && deltaX <= -72;
    if (shouldArchive) {
      card.dataset.swipeSuppress = "true";
      window.setTimeout(() => {
        delete card.dataset.swipeSuppress;
      }, 250);
      openQueueArchiveConfirm(entry, card);
    }
    reset();
  });

  card.addEventListener("pointercancel", reset);
  card.addEventListener("lostpointercapture", () => {
    if (dragging && !horizontal) {
      reset();
    }
  });
}

function openQueueArchiveConfirm(entry, returnFocus = null) {
  const entryId = queueArchiveEntryId(entry);
  if (!entryId) {
    return;
  }
  state.queueArchiveConfirmEntryId = entryId;
  queueArchiveReturnFocus =
    returnFocus instanceof HTMLElement
      ? returnFocus
      : document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
  queueArchiveFocusPending = true;
  renderAll();
}

function closeQueueArchiveConfirm({ restoreFocus = true } = {}) {
  state.queueArchiveConfirmEntryId = "";
  queueArchiveFocusPending = false;
  const focusTarget = queueArchiveReturnFocus;
  queueArchiveReturnFocus = null;
  renderAll();
  if (restoreFocus && focusTarget?.isConnected) {
    focusTarget.focus({ preventScroll: true });
  }
}

function archiveQueueEntry() {
  const target = queueArchiveEntry();
  if (!target) {
    closeQueueArchiveConfirm({ restoreFocus: false });
    return;
  }
  const targetId = queueArchiveEntryId(target);
  const archivedAt = new Date().toISOString();
  state.threadEntries = state.threadEntries.map((entry) =>
    queueArchiveEntryId(entry) === targetId
      ? {
          ...entry,
          archivedAt,
        }
      : entry,
  );
  persistThreadEntries();
  closeQueueArchiveConfirm({ restoreFocus: false });
}

function renderQueueArchiveConfirm() {
  const entry = queueArchiveEntry();
  if (!entry) {
    elements.queueArchiveModal.hidden = true;
    return;
  }

  elements.queueArchiveMeta.textContent = `${entryProjectLabel(entry)} • ${entrySessionLabel(entry)}`;
  elements.queueArchiveMessage.textContent = String(entry.message || "").trim() || "Worker card";
  elements.queueArchiveModal.hidden = false;

  if (queueArchiveFocusPending) {
    queueArchiveFocusPending = false;
    window.setTimeout(() => {
      elements.queueArchiveCancelButton?.focus({ preventScroll: true });
    }, 0);
  }
}

function buildThreadCard({
  entry,
  direction,
  copyKey,
  copyLabel,
  text,
  copyTextValue,
  metaText,
  failed = false,
  queuedPending = false,
  audioKind = "",
  audioText = "",
  attachments = [],
}) {
  const card = document.createElement("article");
  card.className = `thread-card ${direction} detail-card${failed ? " failed" : ""}${queuedPending ? " queued-pending" : ""}`;

  if (copyTextValue) {
    const copyButton = buildCopyButton({
      copyKey,
      label: copyLabel,
      text: copyTextValue,
    });
    card.append(copyButton);
  }

  if (audioKind && audioText) {
    const audioKey = messageAudioKey(entry, audioKind, audioText);
    const audioPayload = messageAudioPayload(entry, audioKind, audioText);
    card.append(
      buildAudioControls({
        audioKey,
        label: audioKind === "response" ? "Play response audio" : "Play message audio",
        payload: audioPayload,
      }),
    );
  }

  const meta = document.createElement("div");
  meta.className = "thread-meta";
  meta.textContent = metaText;

  const body = document.createElement("div");
  body.className = "thread-text";
  renderRichText(body, text, { emptyText: direction === "inbound" ? "Processing…" : "" });
  const attachmentList = buildMessageAttachmentList(attachments);

  card.append(meta, body);
  if (attachmentList) {
    card.append(attachmentList);
  }
  return card;
}

function buildHistoryGroup(entry, { items = [] } = {}) {
  const queuedForLater = historyEntryQueuedForLater(entry, items);
  const pendingLabel = pendingThreadEntryLabel(entry, items);
  const group = document.createElement("div");
  group.className = "history-group";
  group.dataset.requestId = entry.requestId || "";
  group.dataset.historyAnchor = entry.requestId || entry.sentAt || entry.answeredAt || entry.message || "";
  const queuedMeta = ["Queued", "not sent yet", formatTimestamp(entry.sentAt)]
    .filter(Boolean)
    .join(" • ");

  group.append(
    buildThreadCard({
      entry,
      direction: "outbound",
      copyKey: entryCopyKey(entry, "history-message", entry.message),
      copyLabel: "Copy message",
      text: entry.message,
      copyTextValue: entry.message,
      metaText: queuedForLater ? queuedMeta : formatTimestamp(entry.sentAt),
      queuedPending: queuedForLater,
      audioKind: "message",
      audioText: entry.message,
      attachments: entry.attachments,
    }),
  );

  if (queuedForLater) {
    return group;
  }

  const pending = threadEntryIsPending(entry);
  const inboundText =
    pending
      ? `${pendingLabel}…`
      : entry.response || (entry.status === "failed" ? "Failed." : "");
  const inboundMeta =
    pending
      ? pendingLabel
      : formatTimestamp(entry.answeredAt) || (entry.status === "failed" ? "failed" : "");

  group.append(
    buildThreadCard({
      entry,
      direction: "inbound",
      copyKey: entryCopyKey(entry, "history-response", inboundText),
      copyLabel: "Copy response",
      text: inboundText,
      copyTextValue: pending ? "" : inboundText,
      metaText: inboundMeta,
      failed: entry.status === "failed",
      audioKind: pending ? "" : "response",
      audioText: pending ? "" : inboundText,
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
    updateDetailScrollBottomButton();
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
    updateDetailScrollBottomButton();
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
      elements.detailHistoryList.append(buildHistoryGroup(entry, { items: historyState.items }));
    }
  }

  elements.detailHistoryList.dataset.threadKey = threadKey;
  elements.detailHistoryList.dataset.renderKey = renderKey;
  elements.detailModal.hidden = false;
  applyDetailHistorySnapshot(scrollSnapshot);
  window.requestAnimationFrame(updateDetailScrollBottomButton);
}

function buildQuickPromptCard(prompt) {
  const card = document.createElement("article");
  card.className = "quick-prompt-card";
  card.dataset.quickPromptId = prompt.id;

  const useButton = document.createElement("button");
  useButton.className = "quick-prompt-use";
  useButton.type = "button";
  useButton.dataset.quickPromptInsert = prompt.id;

  const title = document.createElement("div");
  title.className = "quick-prompt-title";
  title.textContent = prompt.title;

  const preview = document.createElement("div");
  preview.className = "quick-prompt-preview";
  preview.textContent = prompt.text;

  useButton.append(title, preview);

  const editButton = document.createElement("button");
  editButton.className = "thread-button quick-prompt-edit";
  editButton.type = "button";
  editButton.dataset.quickPromptEdit = prompt.id;
  editButton.setAttribute("aria-label", `Edit ${prompt.title}`);
  editButton.innerHTML = editIconMarkup();

  card.append(useButton, editButton);
  return card;
}

function renderQuickPromptModal() {
  elements.quickPromptButton?.setAttribute("aria-expanded", String(state.quickPromptModalOpen));
  elements.quickPromptButton?.classList.toggle("is-active", state.quickPromptModalOpen);
  if (!state.quickPromptModalOpen) {
    elements.quickPromptModal.hidden = true;
    return;
  }

  const promptCount = state.quickPrompts.length;
  elements.quickPromptSubtitle.textContent =
    promptCount === 1 ? "1 reusable composer insert" : `${promptCount} reusable composer inserts`;
  elements.quickPromptNewButton.disabled = state.quickPromptsSaving;
  elements.quickPromptResetButton.disabled = state.quickPromptsSaving || state.quickPromptsLoading;
  const resetButtonLabel = elements.quickPromptResetButton.querySelector(".button-text");
  if (resetButtonLabel) {
    resetButtonLabel.textContent = state.quickPromptResetConfirm ? "Confirm" : "Defaults";
  }

  if (state.quickPromptsLoading && !state.quickPromptsLoaded) {
    setText(elements.quickPromptState, "Loading quick prompts", { empty: false });
  } else if (state.quickPromptsSaving) {
    setText(elements.quickPromptState, "Saving quick prompts", { empty: false });
  } else if (state.quickPromptResetConfirm) {
    setText(elements.quickPromptState, "Tap Confirm to restore preset prompts", { empty: false });
  } else if (state.quickPromptError) {
    setText(elements.quickPromptState, state.quickPromptError, { empty: false });
  } else {
    setText(elements.quickPromptState, "", { empty: true });
  }

  clearNode(elements.quickPromptList);
  if (state.quickPromptsLoading && !state.quickPromptsLoaded) {
    const card = document.createElement("div");
    card.className = "history-state-card";
    card.textContent = "Loading quick prompts…";
    elements.quickPromptList.append(card);
  } else if (state.quickPrompts.length === 0) {
    const card = document.createElement("div");
    card.className = "history-state-card";
    card.textContent = "No quick prompts yet.";
    elements.quickPromptList.append(card);
  } else {
    for (const prompt of state.quickPrompts) {
      elements.quickPromptList.append(buildQuickPromptCard(prompt));
    }
  }

  const editing = Boolean(state.quickPromptDraftMode);
  elements.quickPromptForm.hidden = !editing;
  if (editing) {
    if (elements.quickPromptTitleInput.value !== state.quickPromptDraftTitle) {
      elements.quickPromptTitleInput.value = state.quickPromptDraftTitle;
    }
    if (elements.quickPromptTextInput.value !== state.quickPromptDraftText) {
      elements.quickPromptTextInput.value = state.quickPromptDraftText;
    }
    elements.quickPromptTitleInput.disabled = state.quickPromptsSaving;
    elements.quickPromptTextInput.disabled = state.quickPromptsSaving;
    elements.quickPromptCancelButton.disabled = state.quickPromptsSaving;
    elements.quickPromptDeleteButton.disabled =
      state.quickPromptsSaving || state.quickPromptDraftMode !== "edit";
    elements.quickPromptSaveButton.disabled =
      state.quickPromptsSaving ||
      !state.quickPromptDraftTitle.trim() ||
      !state.quickPromptDraftText.trim();
    elements.quickPromptSaveButton.querySelector(".button-text").textContent =
      state.quickPromptsSaving ? "Saving…" : "Save";
  }

  elements.quickPromptModal.hidden = false;
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
  const sourceParts = [];
  if (snapshot.sourceEntryCount > 0) {
    sourceParts.push(`${snapshot.sourceEntryCount} note${snapshot.sourceEntryCount === 1 ? "" : "s"}`);
  }
  if (snapshot.sourceSessionCount > 0) {
    sourceParts.push(`${snapshot.sourceSessionCount} session${snapshot.sourceSessionCount === 1 ? "" : "s"}`);
  }
  if (snapshot.contextItemCount > 0) {
    sourceParts.push(`${snapshot.contextItemCount} dashboard signal${snapshot.contextItemCount === 1 ? "" : "s"}`);
  }
  const providerText = snapshot.sessionLabel || providerLabel(snapshot.provider);
  sourceMeta.textContent = `${providerText} • ${sourceParts.length > 0 ? sourceParts.join(" • ") : "project context"}`;

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
  if (state.delegateSupervisorPending) {
    return "checking";
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

function delegateSupervisorIsActive(delegateState) {
  const supervisor = delegateState?.supervisor || null;
  return Boolean(supervisor?.enabled || supervisor?.live || supervisor?.state === "running");
}

function delegateSupervisorGate(delegateState) {
  const preview = delegateState?.supervisorPreview || null;
  return preview?.gate || preview?.supervisor?.lastGateResult || delegateState?.supervisor?.lastGateResult || null;
}

function delegateDirectionCheck(delegateState) {
  const gate = delegateSupervisorGate(delegateState);
  const preview = delegateState?.supervisorPreview || null;
  const latestEvent = delegateLatestSupervisorEvent(delegateState);
  return (
    gate?.directionCheck ||
    preview?.gate?.directionCheck ||
    preview?.supervisor?.lastDirectionCheck ||
    delegateState?.supervisor?.lastDirectionCheck ||
    latestEvent?.payload?.directionCheck ||
    latestEvent?.payload?.gate?.directionCheck ||
    null
  );
}

function delegateDirectionCheckText(check) {
  if (!check || typeof check !== "object") {
    return "";
  }
  const mode = String(check.mode || "").trim();
  const decision = String(check.decision || "").trim();
  const reason = String(check.reason || "").trim();
  if (decision === "skipped" || mode === "off") {
    return "Direction check is off for this lane.";
  }
  return [
    decision ? `Direction ${decision}` : "Direction checked",
    reason,
  ].filter(Boolean).join(" • ");
}

function delegateLatestSupervisorEvent(delegateState) {
  const events = Array.isArray(delegateState?.supervisorEvents) ? delegateState.supervisorEvents : [];
  return events[events.length - 1] || null;
}

function delegateSupervisorEventText(event) {
  if (!event) {
    return "";
  }
  const action = String(event.action || event.type || "").replace(/_/gu, " ").trim();
  const reason = String(event.reason || "").trim();
  const when = formatTimestamp(event.at || "");
  return [action, reason, when].filter(Boolean).join(" • ");
}

function delegateSupervisorEventLabel(event) {
  const type = String(event?.type || "").trim().toLowerCase();
  const action = String(event?.action || "").trim().toLowerCase();
  switch (type || action) {
    case "supervisor_daemon_started":
      return "Loop started";
    case "supervisor_waiting":
    case "wait":
      return "Worker already running";
    case "supervisor_restarted_lane":
    case "restart":
      return "Worker restarted";
    case "supervisor_completed":
    case "completed":
      return "Loop completed";
    case "supervisor_blocked":
    case "blocked":
      return "Blocked";
    case "supervisor_stop_requested":
    case "stop":
      return "Stop requested";
    case "supervisor_restart_rejected":
    case "restart_rejected":
      return "Restart rejected";
    case "supervisor_direction_checked":
    case "direction_check":
      return "Next step checked";
    default:
      return action || type ? String(action || type).replace(/_/gu, " ") : "Supervisor event";
  }
}

function delegateSupervisorEventTone(event) {
  const type = String(event?.type || "").trim().toLowerCase();
  const action = String(event?.action || "").trim().toLowerCase();
  const directionCheck = event?.payload?.directionCheck || event?.payload?.gate?.directionCheck || null;
  if (directionCheck?.enforceable) {
    return "blocked";
  }
  if (/blocked|rejected|failed/u.test(`${type} ${action}`)) {
    return "blocked";
  }
  if (/waiting|started|restart|daemon/u.test(`${type} ${action}`)) {
    return "current";
  }
  if (/completed|stop/u.test(`${type} ${action}`)) {
    return "done";
  }
  return "";
}

function delegateSupervisorEventDetail(event) {
  const payload = event?.payload && typeof event.payload === "object" ? event.payload : {};
  const gate = payload.gate || payload.lastGateResult || {};
  const directionCheck = payload.directionCheck || gate.directionCheck || null;
  return (
    String(event?.reason || "").trim() ||
    delegateDirectionCheckText(directionCheck) ||
    String(gate.reason || gate.lastGateResult?.reason || "").trim() ||
    String(event?.nextAction || "").trim() ||
    String(event?.state || "").trim()
  );
}

function appendDelegateSupervisorEventRow(container, label, value) {
  const cleanValue = String(value || "").trim();
  if (!cleanValue) {
    return;
  }
  const row = document.createElement("div");
  row.className = "delegate-supervisor-event-row";

  const key = document.createElement("span");
  key.className = "delegate-supervisor-event-key";
  key.textContent = label;

  const text = document.createElement("span");
  text.className = "delegate-supervisor-event-value";
  text.textContent = cleanValue;

  row.append(key, text);
  container.append(row);
}

function buildDelegateSupervisorEventCard(event, { latest = false } = {}) {
  const tone = delegateSupervisorEventTone(event);
  const card = document.createElement("article");
  card.className = [
    "delegate-supervisor-event",
    tone ? `is-${tone}` : "",
    latest ? "is-latest" : "",
  ].filter(Boolean).join(" ");

  const marker = document.createElement("span");
  marker.className = "delegate-supervisor-event-marker";
  marker.setAttribute("aria-hidden", "true");

  const body = document.createElement("div");
  body.className = "delegate-supervisor-event-body";

  const head = document.createElement("div");
  head.className = "delegate-supervisor-event-head";

  const title = document.createElement("div");
  title.className = "delegate-supervisor-event-title";
  title.textContent = delegateSupervisorEventLabel(event);

  const at = document.createElement("div");
  at.className = "delegate-supervisor-event-time";
  at.textContent = formatTimestamp(event?.at || "") || "";

  head.append(title, at);

  const detail = document.createElement("div");
  detail.className = "delegate-supervisor-event-detail";
  detail.textContent = shortDelegateRunText(delegateSupervisorEventDetail(event), "", 220);

  const fields = document.createElement("div");
  fields.className = "delegate-supervisor-event-fields";
  appendDelegateSupervisorEventRow(fields, "state", event?.state);
  appendDelegateSupervisorEventRow(fields, "run", event?.runId ? sessionFingerprint(event.runId) : "");
  appendDelegateSupervisorEventRow(fields, "restarts", event?.restartCount ? String(event.restartCount) : "");
  appendDelegateSupervisorEventRow(fields, "next", event?.nextAction);
  appendDelegateSupervisorEventRow(
    fields,
    "direction",
    event?.payload?.directionCheck?.decision || event?.payload?.gate?.directionCheck?.decision || "",
  );

  body.append(head);
  if (detail.textContent) {
    body.append(detail);
  }
  if (fields.childElementCount > 0) {
    body.append(fields);
  }
  card.append(marker, body);
  return card;
}

function delegateChecklistItem(id, label, stateValue, detail = "") {
  return {
    id,
    label,
    state: ["done", "current", "blocked"].includes(stateValue) ? stateValue : "pending",
    detail: String(detail || "").trim(),
  };
}

function delegateLatestStepSnapshot(runLog) {
  const snapshots = delegateStepSnapshots(runLog?.events || []);
  return snapshots[snapshots.length - 1] || null;
}

function delegateLaunchChecklistItems(delegateState, runLog) {
  const status = delegateState?.status || {};
  const supervisor = delegateState?.supervisor || {};
  const preview = delegateState?.supervisorPreview || null;
  const gate = delegateSupervisorGate(delegateState);
  const statusState = String(status.state || "idle").toLowerCase();
  const hasObjective = Boolean(String(delegateState?.config?.objective || delegateState?.brief || "").trim());
  const completed = statusState === "completed";
  const running = statusState === "running" || statusState === "planning";
  const blocked = statusState === "blocked" || statusState === "failed";
  const nextAction = String(status.nextAction || preview?.gate?.nextAction || supervisor.lastConsumedNextAction || "").trim();
  const latestStep = delegateLatestStepSnapshot(runLog);
  const gateOk = Boolean(gate?.ok || preview?.gate?.ok);
  const gateCode = String(gate?.code || preview?.gate?.code || "").trim();
  const gateReason = String(gate?.reason || preview?.gate?.reason || preview?.error || "").trim();
  const directionCheck = delegateDirectionCheck(delegateState);
  const directionMode = String(delegateState?.config?.directionCheckMode || "observe").trim();
  const directionDecision = String(directionCheck?.decision || "").trim();
  const directionBlocked = gateCode === "direction_check" || directionCheck?.enforceable;
  const supervisorPending = Boolean(state.delegateSupervisorPending);

  return [
    delegateChecklistItem(
      "objective",
      "Brief and objective",
      hasObjective ? "done" : "blocked",
      hasObjective ? "Saved lane context is ready." : "Add a goal or current objective before launch.",
    ),
    delegateChecklistItem(
      "lane",
      "Lane available",
      running ? "current" : blocked ? "blocked" : "done",
      running
        ? "A worker run is already active."
        : blocked
          ? status.error || delegateStopReasonLabel(status.stopReason) || "The lane is blocked."
          : "The lane can be supervised.",
    ),
    delegateChecklistItem(
      "next",
      completed ? "Next action" : "Initial objective",
      completed ? nextAction ? "done" : "blocked" : hasObjective ? "done" : "pending",
      completed
        ? nextAction || "A completed lane needs a concrete nextAction before restart."
        : "Supervisor will start from the saved objective.",
    ),
    delegateChecklistItem(
      "orp",
      "ORP safety gates",
      gateOk ? "done" : gateCode && gateCode !== "compute_limit" ? "blocked" : supervisorPending ? "current" : "pending",
      gateOk ? "Hygiene, project refresh, and frontier preflight passed." : gateReason || "Use Preview checks to run ORP before launch.",
    ),
    delegateChecklistItem(
      "compute",
      "Compute reserve",
      gateOk ? "done" : gateCode === "compute_limit" ? "blocked" : supervisorPending ? "current" : "pending",
      gateCode === "compute_limit"
        ? gateReason
        : gateOk
          ? "Reserve guard passed."
          : delegateComputeInlineText(status) || "Reserve guard will run during preview/start.",
    ),
    delegateChecklistItem(
      "direction",
      "Direction check",
      directionBlocked
        ? "blocked"
        : directionDecision
          ? "done"
          : directionMode === "off"
            ? "done"
            : supervisorPending
              ? "current"
              : "pending",
      directionBlocked
        ? directionCheck?.reason || gateReason || "Direction check blocked continuation."
        : directionCheck
          ? delegateDirectionCheckText(directionCheck)
          : directionMode === "off"
            ? "Off for this lane."
            : "Compares outcome, objective, and nextAction before restart.",
    ),
    delegateChecklistItem(
      "worker",
      "Worker run",
      running ? "done" : supervisorPending ? "current" : latestStep ? "done" : "pending",
      running
        ? `Run ${sessionFingerprint(status.runId)} is active.`
        : latestStep
          ? `Latest step ${latestStep.step} is recorded.`
          : "Supervisor starts one bounded worker run at a time.",
    ),
  ];
}

function delegateRuntimeChecklistItems(delegateState, runLog) {
  const status = delegateState?.status || {};
  const supervisor = delegateState?.supervisor || {};
  const gate = delegateSupervisorGate(delegateState);
  const directionCheck = delegateDirectionCheck(delegateState);
  const supervisorEvent = delegateLatestSupervisorEvent(delegateState);
  const supervisorEventText = delegateSupervisorEventText(supervisorEvent);
  const latestStep = delegateLatestStepSnapshot(runLog);
  const statusState = String(status.state || "idle").toLowerCase();
  const running = statusState === "running" || statusState === "planning";
  const terminal = ["completed", "blocked", "failed", "paused"].includes(statusState);
  const checkpointed = Boolean(latestStep?.checkpoint || status.lastOutcomeSummary);
  const supervisorActive = delegateSupervisorIsActive(delegateState);
  const supervisorSeen = supervisorActive || Boolean(supervisor.restartCount) || Boolean(supervisorEvent);
  const workerStateLabel = delegateRunStateLabel(statusState, { prefix: false }).toLowerCase();
  const codexGoal = normalizeDelegateCodexGoal(status.codexGoal);
  const codexGoalBlocked = Boolean(codexGoal?.error) || codexGoal?.supported === false;

  return [
    delegateChecklistItem(
      "supervisor",
      "Loop is on",
      supervisorSeen ? "done" : state.delegateSupervisorPending ? "current" : "pending",
      supervisorSeen
        ? supervisorEventText || `${supervisor.restartCount || 0} restart${supervisor.restartCount === 1 ? "" : "s"} recorded.`
        : "Start loop keeps this off by default until requested.",
    ),
    delegateChecklistItem(
      "gates",
      "Safety gates passed",
      gate?.ok ? "done" : gate?.reason ? "blocked" : running ? "current" : "pending",
      gate?.reason || supervisorEvent?.reason || "Waiting for supervisor gate result.",
    ),
    delegateChecklistItem(
      "direction",
      "Next step checked",
      directionCheck?.enforceable
        ? "blocked"
        : directionCheck
          ? "done"
          : running
            ? "current"
            : "pending",
      directionCheck
        ? delegateDirectionCheckText(directionCheck)
        : "Waiting for the supervisor direction check.",
    ),
    delegateChecklistItem(
      "run",
      "Worker run",
      status.runId ? "done" : "pending",
      status.runId
        ? `${workerStateLabel ? `${workerStateLabel[0].toUpperCase()}${workerStateLabel.slice(1)} ` : ""}run ${sessionFingerprint(status.runId)}`
          : "No worker run yet.",
    ),
    delegateChecklistItem(
      "codex-goal",
      "Codex goal",
      codexGoalBlocked ? "blocked" : codexGoal?.synced || codexGoal?.status ? "done" : running ? "current" : "pending",
      delegateCodexGoalText(codexGoal),
    ),
    delegateChecklistItem(
      "step",
      "Step activity",
      latestStep?.completedAt ? "done" : running ? "current" : terminal ? "done" : "pending",
      latestStep
        ? `Step ${latestStep.step} ${latestStep.completedAt ? "completed" : "in progress"}.`
        : running
          ? "Waiting for the first live step event."
          : "No step events yet.",
    ),
    delegateChecklistItem(
      "readback",
      "Checkpoint readback",
      checkpointed ? "done" : running ? "current" : terminal ? "blocked" : "pending",
      checkpointed
        ? shortDelegateRunText(status.lastOutcomeSummary || latestStep?.summary || latestStep?.nextAction, "Readback captured.", 140)
        : "A completed step should leave outcome and next-action readback.",
    ),
    delegateChecklistItem(
      "decision",
      "Continue or stop decision",
      terminal ? "done" : running ? "current" : "pending",
      terminal
        ? status.error || status.nextAction || delegateStopReasonLabel(status.stopReason) || statusState
        : "Supervisor will consume the nextAction after completion.",
    ),
  ];
}

function buildDelegateChecklistList(items) {
  const list = document.createElement("div");
  list.className = "delegate-checklist";

  for (const item of items) {
    const row = document.createElement("div");
    row.className = `delegate-check-row is-${item.state}`;

    const box = document.createElement("input");
    box.className = "delegate-check-box";
    box.type = "checkbox";
    box.checked = item.state === "done";
    box.disabled = true;
    box.ariaLabel = item.label;

    const body = document.createElement("div");
    body.className = "delegate-check-body";

    const label = document.createElement("div");
    label.className = "delegate-check-label";
    label.textContent = item.label;

    const detail = document.createElement("div");
    detail.className = "delegate-check-detail";
    detail.textContent = item.detail || item.state;

    body.append(label, detail);
    row.append(box, body);
    list.append(row);
  }

  return list;
}

function buildDelegateSupervisorChecklist(project, delegateState, laneId, runLog) {
  const card = document.createElement("section");
  card.className = "delegate-supervisor-card";

  const statusState = String(delegateState?.status?.state || "idle").toLowerCase();
  const supervisor = delegateState?.supervisor || null;
  const supervisorActive = delegateSupervisorIsActive(delegateState);
  const pending = Boolean(state.delegateSupervisorPending);
  const startDisabled = pending || state.delegateBriefPending || state.delegatePlanPending || !project?.path;
  const stopMode = supervisorActive || statusState === "running" || statusState === "planning";

  const head = document.createElement("div");
  head.className = "delegate-supervisor-head";

  const titleWrap = document.createElement("div");
  titleWrap.className = "delegate-supervisor-title-wrap";

  const title = document.createElement("div");
  title.className = "delegate-overview-title";
  title.textContent = "Start checks";

  const meta = document.createElement("div");
  meta.className = "delegate-overview-meta";
  meta.textContent = [
    supervisorActive ? "supervisor on" : "supervisor off",
    supervisor?.lastRestartAt ? `last restart ${formatTimestamp(supervisor.lastRestartAt)}` : "",
    laneId === "default" ? "main lane" : laneId,
  ].filter(Boolean).join(" • ");

  titleWrap.append(title, meta);

  const actions = document.createElement("div");
  actions.className = "delegate-supervisor-actions";

  const preview = document.createElement("button");
  preview.className = "active-run-action-button";
  preview.type = "button";
  preview.dataset.delegateSuperviseAction = "preview";
  preview.disabled = startDisabled || stopMode;
  preview.textContent = state.delegateSupervisorPending === "preview" ? "Checking" : "Preview checks";

  const toggle = document.createElement("button");
  toggle.className = `active-run-action-button${stopMode ? " is-pause" : ""}`;
  toggle.type = "button";
  toggle.dataset.delegateSuperviseAction = stopMode ? "stop" : "start";
  toggle.disabled = startDisabled;
  toggle.textContent = pending ? "Working" : stopMode ? "Stop loop" : "Start loop";

  actions.append(preview, toggle);
  head.append(titleWrap, actions);

  const sections = document.createElement("div");
  sections.className = "delegate-supervisor-sections";

  const launch = document.createElement("div");
  launch.className = "delegate-supervisor-section";
  const launchTitle = document.createElement("div");
  launchTitle.className = "delegate-check-section-title";
  launchTitle.textContent = "Before start";
  launch.append(launchTitle, buildDelegateChecklistList(delegateLaunchChecklistItems(delegateState, runLog)));

  const runtime = document.createElement("div");
  runtime.className = "delegate-supervisor-section";
  const runtimeTitle = document.createElement("div");
  runtimeTitle.className = "delegate-check-section-title";
  runtimeTitle.textContent = "During run";
  runtime.append(runtimeTitle, buildDelegateChecklistList(delegateRuntimeChecklistItems(delegateState, runLog)));

  sections.append(launch, runtime);
  card.append(head, sections);
  return card;
}

function shortDelegateRunText(text, fallback = "", maxLength = 90) {
  const value = String(text || "").replace(/\s+/gu, " ").trim();
  if (!value) {
    return fallback;
  }
  const limit = Math.max(24, Number.parseInt(String(maxLength || 90), 10) || 90);
  return value.length > limit ? `${value.slice(0, limit - 3).trim()}...` : value;
}

function delegateRunIsSidecarRunId(runId) {
  const value = String(runId || "").trim();
  return /\.codex-events(?:\.jsonl)?$/u.test(value);
}

function delegateRunCardData(delegateState, runLog) {
  const runs = new Map();
  for (const run of delegateState?.runList || []) {
    if (!run?.runId || delegateRunIsSidecarRunId(run.runId)) {
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
  if (status?.runId && !delegateRunIsSidecarRunId(status.runId)) {
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
    if (!snapshot?.runId || delegateRunIsSidecarRunId(snapshot.runId)) {
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

  if (runLog?.runId && !delegateRunIsSidecarRunId(runLog.runId) && !runs.has(runLog.runId)) {
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

  const meta = document.createElement("div");
  meta.className = "active-run-meta";
  meta.textContent = [
    formatTimestamp(run.at),
    run.eventCount ? `${run.eventCount} event${run.eventCount === 1 ? "" : "s"}` : "",
    run.runId ? `run ${sessionFingerprint(run.runId)}` : "",
  ].filter(Boolean).join(" • ");
  if (meta.textContent) {
    button.append(meta);
  }

  const summary = document.createElement("div");
  summary.className = "active-run-summary";
  summary.textContent = shortDelegateRunText(run.summary, "", 180);
  if (summary.textContent) {
    button.append(summary);
  }
  return button;
}

function delegateRunStateLabel(state, { prefix = true } = {}) {
  const value = String(state || "").trim().toLowerCase();
  const withPrefix = (label) => prefix ? `Delegation ${label.toLowerCase()}` : label;
  switch (value) {
    case "running":
      return withPrefix("Running");
    case "paused":
      return withPrefix("Paused");
    case "blocked":
      return withPrefix("Blocked");
    case "completed":
      return withPrefix("Completed");
    case "failed":
      return withPrefix("Failed");
    case "planning":
      return withPrefix("Planning");
    case "idle":
      return withPrefix("Idle");
    case "summary":
      return withPrefix("Summary");
    default:
      return prefix ? "Delegation session" : "Session";
  }
}

function delegateRunStepText(status) {
  if (!status) {
    return "";
  }
  if (status.activeStep) {
    return `step ${status.activeStep}`;
  }
  if (status.stepCount > 0) {
    return `step ${status.stepCount}`;
  }
  return "";
}

function delegateComputeInlineText(status) {
  const budget = status?.computeBudget;
  if (!budget) {
    return "";
  }
  const used = Number.isFinite(budget.usedPercent) ? `${Math.round(budget.usedPercent)}% used` : "";
  const remaining = Number.isFinite(budget.remainingPercent)
    ? `${Math.round(budget.remainingPercent)}% left`
    : "";
  return [used, remaining].filter(Boolean).join(" • ");
}

function activeRunCardMetaParts(status) {
  const stateLabel = delegateRunStateLabel(status?.state || "", { prefix: false });
  const stepText = delegateRunStepText(status);
  const updatedAt = formatTimestamp(
    status?.updatedAt || status?.completedAt || status?.startedAt || "",
  );
  return [stateLabel, stepText, updatedAt].filter(Boolean);
}

function delegateLaneDisplayText(project) {
  const lane = project?.delegateLane || {};
  const laneId = normalizeDelegateLaneId(project?.laneId || lane?.laneId || "default");
  const displayName = String(lane?.displayName || "").trim();
  if (laneId === "default") {
    return displayName && !/^default delegate$/iu.test(displayName) ? displayName : "Main lane";
  }
  if (displayName) {
    return displayName;
  }
  return laneId;
}

function delegateLaneShortId(project) {
  const laneId = normalizeDelegateLaneId(project?.laneId || project?.delegateLane?.laneId || "default");
  return laneId === "default" ? "" : laneId;
}

function delegateLaneMetaLabel(project) {
  const laneId = delegateLaneShortId(project);
  if (!laneId) {
    return "";
  }
  const displayName = delegateLaneDisplayText(project);
  return displayName && displayName !== laneId ? `${displayName} (${laneId})` : laneId;
}

function delegateProjectCardTitle(project) {
  return project?.displayName || project?.slug || fallbackProjectLabel(project?.path);
}

function delegateComputeStateText(computeState) {
  if (!computeState) {
    return "";
  }
  if (typeof computeState === "string") {
    return String(computeState).trim();
  }
  const budget = normalizeDelegateComputeBudget(computeState);
  if (!budget) {
    return "";
  }
  return delegateComputeInlineText({ computeBudget: budget }) || String(budget.status || "").trim();
}

function compactSingleLine(value = "", maxLength = 170) {
  const normalized = String(value || "").replace(/\s+/gu, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trim()}...`;
}

function appendDelegateOverviewField(container, label, value) {
  const item = document.createElement("div");
  item.className = "delegate-overview-field";

  const fieldLabel = document.createElement("div");
  fieldLabel.className = "delegate-overview-label";
  fieldLabel.textContent = label;

  const fieldValue = document.createElement("div");
  fieldValue.className = "delegate-overview-value";
  fieldValue.textContent = value;

  item.append(fieldLabel, fieldValue);
  container.append(item);
}

function delegateCodexGoalText(goal) {
  const normalized = normalizeDelegateCodexGoal(goal);
  if (!normalized) {
    return "Not synced yet.";
  }
  if (normalized.mode === "off") {
    return "Off for this service.";
  }
  const pieces = [];
  if (normalized.status) {
    pieces.push(normalized.status === "budgetLimited" ? "budget-limited" : normalized.status);
  } else {
    pieces.push(normalized.synced ? "synced" : "pending");
  }
  if (normalized.supported === false) {
    pieces.push("unsupported");
  } else if (normalized.synced) {
    pieces.push("synced");
  } else if (normalized.skipped) {
    pieces.push("skipped");
  }
  if (normalized.updatedAt) {
    pieces.push(formatTimestamp(normalized.updatedAt));
  }
  const objective = shortDelegateRunText(normalized.objective, "", 140);
  const base = pieces.filter(Boolean).join(" • ");
  return [base, normalized.error || objective].filter(Boolean).join(" — ") || "Not synced yet.";
}

function buildDelegateOverview(project, delegateState, laneId, laneLabel) {
  const overview = document.createElement("section");
  overview.className = "delegate-overview-card";

  const statusState = String(delegateState?.status?.state || "").trim().toLowerCase();
  const live = statusState === "running";
  const paused = statusState === "paused" || delegateState?.status?.pauseRequested;
  const blocked = statusState === "blocked" || statusState === "failed";
  const supervisorActive = delegateSupervisorIsActive(delegateState);
  const brief = String(delegateState?.brief || "").trim();
  const watchtowerMode = String(delegateState?.config?.watchtowerReviewMode || "off").trim() || "off";
  const directionMode = String(delegateState?.config?.directionCheckMode || "observe").trim() || "observe";
  const projectLabel = project?.displayName || project?.slug || fallbackProjectLabel(project?.path);
  const runText = live
    ? "Live loop running"
    : supervisorActive
      ? "Supervisor watching"
    : paused
      ? "Pause requested"
      : blocked
        ? "Needs attention"
        : "Ready to launch";
  const briefText = brief
    ? compactSingleLine(brief)
    : "No saved goal yet. Use Goal to set the objective before launch.";

  const head = document.createElement("div");
  head.className = "delegate-overview-head";

  const title = document.createElement("div");
  title.className = "delegate-overview-title";
  title.textContent = "Auto-Claw loop";

  const meta = document.createElement("div");
  meta.className = "delegate-overview-meta";
  meta.textContent = [
    projectLabel,
    laneLabel || (laneId === "default" ? "Main lane" : laneId),
    runText,
  ].filter(Boolean).join(" • ");

  head.append(title, meta);

  const fields = document.createElement("div");
  fields.className = "delegate-overview-fields";
  appendDelegateOverviewField(fields, "Goal", briefText);
  appendDelegateOverviewField(fields, "Source", "ORP frontier plus the saved brief for this lane.");
  appendDelegateOverviewField(fields, "Start checks", "ORP hygiene and frontier checks must pass before delegate work starts.");
  appendDelegateOverviewField(fields, "Loop", "Delegate step, status readback, run log, then continue until done or blocked.");
  appendDelegateOverviewField(fields, "Stops", "Completion, hard stop, compute reserve, explicit pause, or failed preflight.");
  appendDelegateOverviewField(
    fields,
    "Direction",
    directionMode === "off" ? "Off for this lane." : `${directionMode}: checks outcome and nextAction before restart.`,
  );
  appendDelegateOverviewField(fields, "Watchtower", watchtowerMode === "off" ? "Off unless explicitly enabled." : watchtowerMode);
  appendDelegateOverviewField(fields, "Codex goal", delegateCodexGoalText(delegateState?.status?.codexGoal));

  overview.append(head, fields);
  return overview;
}

function delegateHygieneStateText(hygieneState = "") {
  switch (String(hygieneState || "").trim().toLowerCase()) {
    case "clean":
    case "ok":
      return "Clean";
    case "cleanup_queued":
      return "Cleanup queued";
    case "checkpoint_required":
    case "needs_checkpoint":
      return "Needs checkpoint";
    case "dirty_external":
      return "External dirt";
    case "review":
      return "Paused for review";
    case "blocked":
      return "Blocked";
    default:
      return hygieneState ? String(hygieneState).replace(/_/gu, " ") : "";
  }
}

function delegateHygieneTone(hygieneState = "") {
  switch (String(hygieneState || "").trim().toLowerCase()) {
    case "clean":
    case "ok":
      return " is-ok";
    case "cleanup_queued":
    case "checkpoint_required":
    case "needs_checkpoint":
      return " is-work";
    case "dirty_external":
    case "review":
      return " is-review";
    case "blocked":
      return " is-blocked";
    default:
      return "";
  }
}

function buildDelegateLaneCard(project, { showProject = false, compact = false } = {}) {
  const card = document.createElement("article");
  card.className = `active-run-card delegate-lane-card${compact ? " is-compact" : ""}`;
  card.dataset.projectPath = project.path;
  card.dataset.laneId = normalizeDelegateLaneId(project.laneId || project?.delegateLane?.laneId || "default");

  const status = projectDelegateStatus(project);
  const delegateState = delegateStateFor(project.path, card.dataset.laneId);
  const liveStatus = delegateState?.status || status || null;
  const supervisorActive = delegateSupervisorIsActive({
    supervisor: project.supervisor || delegateState?.supervisor || null,
  });
  const runId = String(liveStatus?.runId || "").trim();
  const statusState = String(liveStatus?.state || "").trim().toLowerCase();
  const running = statusState === "running" || statusState === "planning";
  const pauseRequested = Boolean(liveStatus?.pauseRequested);
  const title = document.createElement("div");
  title.className = "active-run-title";
  title.textContent = showProject ? delegateProjectCardTitle(project) : delegateLaneDisplayText(project);

  const meta = document.createElement("div");
  meta.className = "active-run-meta";
  const laneMeta = card.dataset.laneId === "default" ? "default lane" : card.dataset.laneId;
  meta.textContent = [
    showProject ? delegateLaneMetaLabel(project) : laneMeta,
    ...activeRunCardMetaParts(liveStatus),
  ].filter(Boolean).join(" • ") || "Delegate lane";

  const body = document.createElement("div");
  body.className = "delegate-lane-body";

  for (const [label, text] of [
    ["Objective", project.currentObjective],
    ["Latest", project.latestOutcome || projectDelegateSummaryText(project)],
    ["Next", project.nextAction],
  ]) {
    const value = shortDelegateRunText(text, "", label === "Objective" ? 160 : 180);
    if (!value) {
      continue;
    }
    const line = document.createElement("div");
    line.className = "delegate-lane-line";
    const lineLabel = document.createElement("span");
    lineLabel.className = "delegate-lane-line-label";
    lineLabel.textContent = `${label}:`;
    const lineValue = document.createElement("span");
    lineValue.className = "delegate-lane-line-value";
    lineValue.textContent = value;
    line.append(lineLabel, lineValue);
    body.append(line);
  }

  const summary = document.createElement("div");
  summary.className = "active-run-summary";
  summary.textContent =
    body.childElementCount > 0
      ? ""
      : shortDelegateRunText(
          liveStatus?.error ||
            liveStatus?.lastOutcomeSummary ||
            liveStatus?.nextAction ||
            projectDelegateSummaryText(project),
          "Open this lane",
          180,
        ) || "Open this lane";

  const footer = document.createElement("div");
  footer.className = "active-run-footer";

  const compute = document.createElement("span");
  compute.className = "active-run-chip";
  compute.textContent = delegateComputeStateText(project.computeState) || (runId ? `run ${sessionFingerprint(runId)}` : "delegate");

  const hygiene = document.createElement("span");
  hygiene.className = `active-run-chip hygiene-chip${delegateHygieneTone(project.hygieneState)}`;
  hygiene.textContent = delegateHygieneStateText(project.hygieneState);
  if (project.hygieneReason) {
    hygiene.title = project.hygieneReason;
  }
  hygiene.hidden = !hygiene.textContent;

  const actions = document.createElement("div");
  actions.className = "active-run-actions";

  if (running || supervisorActive) {
    const pause = document.createElement("button");
    pause.className = "active-run-action-button is-pause";
    pause.type = "button";
    pause.dataset.delegateAction = "pause";
    pause.disabled = pauseRequested;
    pause.textContent = pauseRequested ? "Stopping" : supervisorActive ? "Stop loop" : "Stop";
    pause.setAttribute(
      "aria-label",
      pauseRequested
        ? "Stop already requested for this delegation lane"
        : "Stop this delegation lane after the current safe point",
    );
    actions.append(pause);
  }

  const open = document.createElement("button");
  open.className = "active-run-action-button";
  open.type = "button";
  open.dataset.delegateAction = "open";
  open.textContent = "Open";
  actions.append(open);

  footer.append(compute, hygiene, actions);
  card.append(title, meta);
  if (!compact && body.childElementCount > 0) {
    card.append(body);
  } else if (!compact) {
    card.append(summary);
  }
  card.append(footer);
  return card;
}

function setWorkspaceMode(mode) {
  const nextMode = mode === "auto" ? mode : "project";
  if (state.workspaceMode === nextMode) {
    return;
  }
  state.workspaceMode = nextMode;
  renderAll();
  if (nextMode === "auto") {
    void primeActiveRunsModal().then(renderAll).catch(showError);
  }
}

function renderWorkspaceTabs() {
  const mode = state.workspaceMode === "auto" ? "auto" : "project";
  const activeCount = activeDelegateProjects().length;
  const hasProject = !catalogBlocksInteraction() && Boolean(state.selectedProject);

  if (elements.projectWorkspaceTab) {
    elements.projectWorkspaceTab.classList.toggle("is-active", mode === "project");
    elements.projectWorkspaceTab.setAttribute("aria-pressed", String(mode === "project"));
    elements.projectWorkspaceTab.tabIndex = 0;
  }
  if (elements.autoWorkspaceTab) {
    elements.autoWorkspaceTab.classList.toggle("is-active", mode === "auto");
    elements.autoWorkspaceTab.classList.toggle("has-live-delegates", activeCount > 0);
    elements.autoWorkspaceTab.setAttribute("aria-pressed", String(mode === "auto"));
    elements.autoWorkspaceTab.setAttribute(
      "aria-label",
      activeCount > 0
        ? `Delegation dashboard, ${activeCount} live lane${activeCount === 1 ? "" : "s"}`
        : "Delegation dashboard",
    );
    elements.autoWorkspaceTab.tabIndex = 0;
  }
  if (elements.summaryWorkspaceTab) {
    elements.summaryWorkspaceTab.classList.remove("is-active");
    elements.summaryWorkspaceTab.disabled = !hasProject;
    elements.summaryWorkspaceTab.setAttribute("aria-disabled", String(!hasProject));
  }
  if (elements.projectWorkspacePane) {
    elements.projectWorkspacePane.hidden = mode !== "project";
  }
  if (elements.autoWorkspacePane) {
    elements.autoWorkspacePane.hidden = mode !== "auto";
  }
}

function renderSelectedProjectDelegateCard() {
  if (!elements.selectedProjectDelegateList) {
    return;
  }

  const project = currentProject();
  const lanes = project ? projectDelegateLaneItems(project) : [];
  const loadingCount = lanes.filter((lane) => delegateStateFor(lane.path, lane.laneId).loading).length;

  if (elements.selectedProjectDelegateMeta) {
    elements.selectedProjectDelegateMeta.textContent =
      project?.path
        ? `Selected project • ${project.displayName || project.slug || fallbackProjectLabel(project.path)} • ${lanes.length} lane${lanes.length === 1 ? "" : "s"}`
        : "Selected project lanes";
  }

  if (!project?.path) {
    setText(elements.selectedProjectDelegateState, "Pick a project to view its delegate lanes.", { empty: false });
  } else if (lanes.length === 0) {
    setText(elements.selectedProjectDelegateState, "No delegate lanes yet.", { empty: false });
  } else if (loadingCount > 0) {
    setText(
      elements.selectedProjectDelegateState,
      `Refreshing ${loadingCount} lane${loadingCount === 1 ? "" : "s"}`,
      { empty: false },
    );
  } else {
    setText(elements.selectedProjectDelegateState, "Saved lanes for the selected project.", { empty: false });
  }

  const renderKey = JSON.stringify(
    lanes.map((lane) => [
      lane.path,
      lane.laneId,
      lane.delegateStatus?.state || "",
      lane.delegateStatus?.runId || "",
      lane.currentObjective || "",
      lane.latestOutcome || "",
      lane.nextAction || "",
      lane.supervisor?.state || "",
      Number(Boolean(lane.supervisor?.enabled)),
      lane.hygieneState || "",
      lane.hygieneReason || "",
      delegateComputeStateText(lane.computeState),
      Number(Boolean(delegateStateFor(lane.path, lane.laneId).loading)),
    ]),
  );
  if (elements.selectedProjectDelegateList.dataset.renderKey === renderKey) {
    return;
  }

  clearNode(elements.selectedProjectDelegateList);
  if (!project?.path) {
    const card = document.createElement("div");
    card.className = "history-state-card";
    card.textContent = "Select a project to open its delegate lanes.";
    elements.selectedProjectDelegateList.append(card);
  } else {
    for (const lane of lanes) {
      elements.selectedProjectDelegateList.append(buildDelegateLaneCard(lane, { compact: true }));
    }
  }
  elements.selectedProjectDelegateList.dataset.renderKey = renderKey;
}

function renderActiveRunsInline() {
  if (!elements.activeRunsInlineList) {
    return;
  }

  const projects = activeDelegateProjects();
  const loadingCount = projects.filter((project) => delegateStateFor(project.path, project.laneId).loading).length;
  const activeCount = projects.length;

  if (elements.activeRunsInlineMeta) {
    elements.activeRunsInlineMeta.textContent =
      activeCount > 0
        ? `${activeCount} live lane${activeCount === 1 ? "" : "s"}`
        : "No live lanes";
  }

  if (activeCount === 0) {
    setText(elements.activeRunsInlineState, "No delegation is running right now.", { empty: false });
  } else if (loadingCount > 0) {
    setText(elements.activeRunsInlineState, `Refreshing ${loadingCount} lane${loadingCount === 1 ? "" : "s"}`, {
      empty: false,
    });
  } else {
    setText(elements.activeRunsInlineState, "Open a live lane to inspect its run.", { empty: false });
  }

  const renderKey = JSON.stringify(
    projects.map((project) => {
      const status = projectDelegateStatus(project);
      const delegateState = delegateStateFor(project.path, project.laneId);
      const liveStatus = delegateState?.status || status || null;
      return [
        project.path,
        project.laneId,
        project.displayName || project.slug || "",
        liveStatus?.state || "",
        liveStatus?.runId || "",
        liveStatus?.activeStep || 0,
        liveStatus?.stepCount || 0,
        liveStatus?.updatedAt || "",
        project.currentObjective || "",
        project.latestOutcome || liveStatus?.lastOutcomeSummary || "",
        project.nextAction || liveStatus?.nextAction || "",
        project.hygieneState || "",
        project.hygieneReason || "",
        delegateComputeStateText(project.computeState),
        liveStatus?.error || "",
        delegateState?.supervisor?.state || "",
        Number(Boolean(delegateState?.supervisor?.enabled)),
        Number(Boolean(delegateState.loading)),
      ];
    }),
  );

  if (elements.activeRunsInlineList.dataset.renderKey === renderKey) {
    return;
  }

  clearNode(elements.activeRunsInlineList);
  if (projects.length === 0) {
    const card = document.createElement("div");
    card.className = "history-state-card";
    card.textContent = "No live delegation runs.";
    elements.activeRunsInlineList.append(card);
  } else {
    for (const project of projects) {
      elements.activeRunsInlineList.append(buildDelegateLaneCard(project, { showProject: true }));
    }
  }
  elements.activeRunsInlineList.dataset.renderKey = renderKey;
}

async function primeActiveRunsModal() {
  const projects = activeDelegateProjects();
  await Promise.all(
    projects.map((project) =>
      loadDelegateProject(project.path, {
        force: false,
        includeRunLog: false,
        includeFeed: false,
        laneId: project.laneId,
      }).catch(() => delegateStateFor(project.path, project.laneId)),
    ),
  );
}

function renderActiveRunsModal() {
  if (!state.activeRunsModalOpen) {
    setText(elements.activeRunsState, "", { empty: true });
    clearNode(elements.activeRunsList);
    delete elements.activeRunsList.dataset.renderKey;
    elements.activeRunsModal.hidden = true;
    return;
  }

  const projects = activeDelegateProjects();
  const loadingCount = projects.filter((project) => delegateStateFor(project.path, project.laneId).loading).length;
  const activeCount = projects.length;

  elements.activeRunsMeta.textContent =
    activeCount > 0
      ? `${activeCount} live lane${activeCount === 1 ? "" : "s"}`
      : "No live delegation";

  if (activeCount === 0) {
    setText(elements.activeRunsState, "No delegation is running right now.", { empty: false });
  } else if (loadingCount > 0) {
    setText(elements.activeRunsState, `Refreshing ${loadingCount} lane${loadingCount === 1 ? "" : "s"}`, { empty: false });
  } else {
    setText(elements.activeRunsState, "Open a live lane to inspect its run.", {
      empty: false,
    });
  }

  const renderKey = JSON.stringify(
    projects.map((project) => {
      const status = projectDelegateStatus(project);
      const delegateState = delegateStateFor(project.path, project.laneId);
      const liveStatus = delegateState?.status || status || null;
      return [
        project.path,
        project.laneId,
        project.displayName || project.slug || "",
        liveStatus?.state || "",
        liveStatus?.runId || "",
        liveStatus?.activeStep || 0,
        liveStatus?.stepCount || 0,
        liveStatus?.updatedAt || "",
        project.currentObjective || "",
        project.latestOutcome || liveStatus?.lastOutcomeSummary || "",
        project.nextAction || liveStatus?.nextAction || "",
        project.hygieneState || "",
        project.hygieneReason || "",
        delegateComputeStateText(project.computeState),
        liveStatus?.error || "",
        delegateState?.supervisor?.state || "",
        Number(Boolean(delegateState?.supervisor?.enabled)),
        Number(Boolean(delegateState.loading)),
      ];
    }),
  );

  if (elements.activeRunsList.dataset.renderKey !== renderKey) {
    clearNode(elements.activeRunsList);
    if (projects.length === 0) {
      const card = document.createElement("div");
      card.className = "history-state-card";
      card.textContent = "No live delegation runs.";
      elements.activeRunsList.append(card);
    } else {
      for (const project of projects) {
        elements.activeRunsList.append(buildDelegateLaneCard(project, { showProject: true }));
      }
    }
    elements.activeRunsList.dataset.renderKey = renderKey;
  }

  elements.activeRunsModal.hidden = false;
}

function renderDelegateCarouselChrome() {
  const activeSlideId = delegateCarouselSlides[delegateCarouselSlideIndex()]?.id || "progress";
  const activeSlide = delegateCarouselSlides.find((slide) => slide.id === activeSlideId) || delegateCarouselSlides[0];
  const panelBySlide = {
    progress: elements.delegateProgressPanel,
    history: elements.delegateRunsPanel,
    details: elements.delegateRunLogPanel,
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

function renderDelegateSupervisorTimeline(delegateState) {
  if (!elements.delegateSupervisorList) {
    return;
  }

  const events = Array.isArray(delegateState?.supervisorEvents)
    ? delegateState.supervisorEvents
    : [];
  const renderKey = JSON.stringify(
    events.map((event) => [
      event.id,
      event.at,
      event.type,
      event.action,
      event.state,
      event.reason,
      event.nextAction,
      event.runId,
      event.restartCount,
    ]),
  );
  if (elements.delegateSupervisorList.dataset.renderKey === renderKey) {
    return;
  }

  clearNode(elements.delegateSupervisorList);
  if (events.length === 0) {
    const card = document.createElement("div");
    card.className = "history-state-card";
    card.textContent = "No supervisor transitions yet.";
    elements.delegateSupervisorList.append(card);
  } else {
    const ordered = [...events].sort((left, right) => {
      const leftMs = Date.parse(left.at || "");
      const rightMs = Date.parse(right.at || "");
      return (Number.isFinite(rightMs) ? rightMs : 0) - (Number.isFinite(leftMs) ? leftMs : 0);
    });
    ordered.forEach((event, index) => {
      elements.delegateSupervisorList.append(buildDelegateSupervisorEventCard(event, { latest: index === 0 }));
    });
  }
  elements.delegateSupervisorList.dataset.renderKey = renderKey;
}

function appendDelegateDebugRow(container, label, value) {
  const cleanValue = String(value || "").trim();
  if (!cleanValue) {
    return;
  }
  const row = document.createElement("div");
  row.className = "delegate-debug-row";

  const key = document.createElement("div");
  key.className = "delegate-overview-label";
  key.textContent = label;

  const text = document.createElement("div");
  text.className = "delegate-overview-value";
  text.textContent = cleanValue;

  row.append(key, text);
  container.append(row);
}

function renderDelegateDebugList(project, delegateState, laneId, runLog) {
  if (!elements.delegateDebugList) {
    return;
  }

  const status = delegateState?.status || {};
  const supervisor = delegateState?.supervisor || {};
  const delegateSession = delegateState?.delegateSession || {};
  const codexGoal = normalizeDelegateCodexGoal(status.codexGoal);
  const renderKey = JSON.stringify({
    projectPath: project?.path || "",
    laneId,
    statusState: status.state || "",
    runId: status.runId || runLog?.runId || "",
    activeRequestId: status.activeRequestId || "",
    delegateSessionId: status.delegateSessionId || delegateSession.sessionId || "",
    supervisorState: supervisor.state || "",
    supervisorPid: supervisor.pid || "",
    codexGoal,
    updatedAt: status.updatedAt || supervisor.updatedAt || "",
  });
  if (elements.delegateDebugList.dataset.renderKey === renderKey) {
    return;
  }

  clearNode(elements.delegateDebugList);
  appendDelegateDebugRow(elements.delegateDebugList, "Lane", laneId === "default" ? "Main lane" : laneId);
  appendDelegateDebugRow(elements.delegateDebugList, "State", delegateRunStateLabel(status.state, { prefix: false }));
  appendDelegateDebugRow(elements.delegateDebugList, "Run ID", status.runId || runLog?.runId || "");
  appendDelegateDebugRow(elements.delegateDebugList, "Active request", status.activeRequestId || "");
  appendDelegateDebugRow(
    elements.delegateDebugList,
    "Delegate session",
    status.delegateSessionId || delegateSession.sessionId || "",
  );
  appendDelegateDebugRow(
    elements.delegateDebugList,
    "Session label",
    status.delegateSessionLabel || delegateSession.label || "",
  );
  appendDelegateDebugRow(
    elements.delegateDebugList,
    "Loop",
    [
      supervisor.enabled ? "on" : "off",
      supervisor.state || "",
      supervisor.pid ? `pid ${supervisor.pid}` : "",
    ].filter(Boolean).join(" • "),
  );
  appendDelegateDebugRow(elements.delegateDebugList, "Codex goal", delegateCodexGoalText(codexGoal));
  appendDelegateDebugRow(elements.delegateDebugList, "Updated", formatTimestamp(status.updatedAt || supervisor.updatedAt || ""));

  if (elements.delegateDebugList.childElementCount === 0) {
    const card = document.createElement("div");
    card.className = "history-state-card";
    card.textContent = "No diagnostic IDs are available yet.";
    elements.delegateDebugList.append(card);
  }
  elements.delegateDebugList.dataset.renderKey = renderKey;
}

function renderDelegateStartChecks(project, delegateState, laneId, runLog) {
  if (!elements.delegateDiagnosticsChecks) {
    return;
  }

  const latestStep = delegateLatestStepSnapshot(runLog);
  const renderKey = JSON.stringify({
    projectPath: project?.path || "",
    laneId,
    status: delegateState?.status || null,
    supervisor: delegateState?.supervisor || null,
    preview: delegateState?.supervisorPreview || null,
    latestStep: latestStep
      ? [latestStep.step, latestStep.completedAt, latestStep.latestAt, latestStep.summary, latestStep.nextAction, latestStep.state]
      : null,
    pending: state.delegateSupervisorPending || "",
  });
  if (elements.delegateDiagnosticsChecks.dataset.renderKey === renderKey) {
    return;
  }

  clearNode(elements.delegateDiagnosticsChecks);
  elements.delegateDiagnosticsChecks.append(buildDelegateSupervisorChecklist(project, delegateState, laneId, runLog));
  elements.delegateDiagnosticsChecks.dataset.renderKey = renderKey;
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

function delegateProgressCleanPlanStep(text) {
  return String(text || "")
    .replace(/\s+/gu, " ")
    .replace(/^\*\*(.*?)\*\*\s*[:.-]?\s*/u, "$1 ")
    .replace(/^[-*]\s+/u, "")
    .trim();
}

function delegatePlanNextSteps(planMarkdown) {
  const planText = typeof planMarkdown === "string" ? planMarkdown : String(planMarkdown?.plan || "");
  const steps = [];
  let inFence = false;
  for (const line of planText.split(/\r?\n/u)) {
    if (/^\s*```/u.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      continue;
    }

    const match = line.match(/^\s*(?:#{1,6}\s*)?(?:(\d{1,2})[.)]|step\s+(\d{1,2})\s*[:.)-])\s+(.+)$/iu);
    const text = delegateProgressCleanPlanStep(match?.[3] || "");
    if (!text) {
      continue;
    }
    steps.push({
      id: `plan-step:${match[1] || match[2] || steps.length + 1}`,
      source: "Saved plan",
      text,
    });
  }
  return steps;
}

function delegateProgressTextKey(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, " ")
    .trim();
}

function delegateProgressUsefulCheckpointText(value) {
  const clean = String(value || "").trim();
  if (!clean || /^(none|n\/a|na|not applicable|no)$/iu.test(clean)) {
    return "";
  }
  return clean;
}

function delegateProgressCheckpointText(checkpoint) {
  if (!checkpoint) {
    return "";
  }
  const pieces = [
    delegateProgressUsefulCheckpointText(checkpoint.progressSignal),
    delegateProgressUsefulCheckpointText(checkpoint.breakthroughs),
    delegateProgressUsefulCheckpointText(checkpoint.blockers),
  ].filter(Boolean);
  return pieces.join(" • ");
}

function delegateProgressPriorityItems(delegateState, latestStep, latestPlan) {
  const status = delegateState?.status || {};
  const items = [];
  const seen = new Set();
  const addItem = (id, source, text, tone = "") => {
    const cleanText = String(text || "").replace(/\s+/gu, " ").trim();
    if (!cleanText) {
      return;
    }
    const key = delegateProgressTextKey(cleanText);
    if (key && seen.has(key)) {
      return;
    }
    if (key) {
      seen.add(key);
    }
    items.push({ id, source, text: cleanText, tone });
  };

  const nextAction = String(status.nextAction || "").trim();
  if (nextAction) {
    addItem("status-next-action", "Selected next action", nextAction, "primary");
  } else {
    addItem(
      "delegate-will-choose",
      "Delegate",
      "The delegate will choose after this step.",
      "fallback",
    );
  }

  addItem(
    "checkpoint-next-probe",
    "Checkpoint next probe",
    latestStep?.checkpoint?.nextProbe,
    "checkpoint",
  );

  for (const [index, step] of delegatePlanNextSteps(latestPlan).entries()) {
    addItem(`plan-step:${index + 1}`, step.source, step.text, "plan");
    if (items.length >= 6) {
      break;
    }
  }

  return items;
}

function buildDelegateProgressModel(delegateState, runLog) {
  const status = delegateState?.status || {};
  const events = Array.isArray(runLog?.events) ? runLog.events : [];
  const steps = delegateStepSnapshots(events);
  const done = steps
    .filter((snapshot) => snapshot.completedAt)
    .map((snapshot) => {
      const checkpointText = delegateProgressCheckpointText(snapshot.checkpoint);
      return {
        id: `done-step:${snapshot.step}`,
        step: snapshot.step,
        title: `Step ${snapshot.step}`,
        timestamp: snapshot.completedAt,
        outcome: shortDelegateRunText(
          snapshot.error || snapshot.summary || snapshot.responseText,
          "Completed step recorded.",
          220,
        ),
        checkpoint: shortDelegateRunText(checkpointText, "", 180),
        validation: shortDelegateRunText(
          snapshot.error || snapshot.stopReason || snapshot.state || snapshot.checkpoint?.confidence,
          "",
          120,
        ),
      };
    });

  const latestStep = steps[steps.length - 1] || null;
  const activeStep = steps.find((snapshot) => !snapshot.completedAt) || null;
  const statusState = String(status.state || "idle").trim().toLowerCase();
  const running = statusState === "running" || statusState === "planning";
  const latestLive = latestDelegateEvent(events, (event) => event.type === "agent_live" && event.text);
  const latestStarted = latestDelegateEvent(events, (event) => event.type === "step_started");
  const activeStepNumber = activeStep?.step || status.activeStep || (running && status.stepCount ? status.stepCount + 1 : null);
  const activeText =
    latestLive?.text ||
    activeStep?.liveText ||
    status.nextAction ||
    activeStep?.title ||
    latestStarted?.text ||
    (running
      ? "The delegate is working on the current step. Live text appears here as the agent writes."
      : "");
  const workingNow = running || activeStep
    ? [
        {
          id: "working-now",
          title:
            statusState === "planning"
              ? "Planning"
              : activeStepNumber
                ? `Step ${activeStepNumber}`
                : "Worker run",
          timestamp: latestLive?.at || activeStep?.latestAt || status.updatedAt || status.startedAt || "",
          meta: [
            delegateRunStateLabel(statusState, { prefix: false }),
            status.activeRequestId ? `request ${status.activeRequestId}` : "",
          ].filter(Boolean).join(" • "),
          text: shortDelegateRunText(activeText, "Waiting for live agent output.", 260),
        },
      ]
    : [];

  return {
    done,
    workingNow,
    nextUp: delegateProgressPriorityItems(delegateState, latestStep, delegateState?.latestPlanSnapshot),
    latestStep,
  };
}

function appendDelegateProgressText(root, className, text, { rich = false, emptyText = "" } = {}) {
  const value = String(text || "").trim();
  if (!value && !emptyText) {
    return;
  }
  const node = document.createElement("div");
  node.className = className;
  if (rich) {
    renderRichText(node, value, { emptyText });
  } else {
    node.textContent = value || emptyText;
  }
  root.append(node);
}

function buildDelegateDoneCard(item) {
  const card = document.createElement("article");
  card.className = "delegate-progress-card is-done";

  const marker = document.createElement("span");
  marker.className = "delegate-progress-marker";
  marker.setAttribute("aria-hidden", "true");

  const body = document.createElement("div");
  body.className = "delegate-progress-card-body";

  const head = document.createElement("div");
  head.className = "delegate-progress-card-head";

  const title = document.createElement("div");
  title.className = "delegate-progress-title";
  title.textContent = item.title;

  const time = document.createElement("div");
  time.className = "delegate-progress-time";
  time.textContent = formatTimestamp(item.timestamp) || "";

  head.append(title, time);
  body.append(head);
  appendDelegateProgressText(body, "delegate-progress-body", item.outcome, { rich: true });
  appendDelegateProgressText(body, "delegate-progress-note", item.checkpoint);
  appendDelegateProgressText(body, "delegate-progress-note", item.validation);
  card.append(marker, body);
  return card;
}

function buildDelegateWorkingCard(item) {
  const card = document.createElement("article");
  card.className = "delegate-progress-card is-working";

  const marker = document.createElement("span");
  marker.className = "delegate-progress-spinner";
  marker.setAttribute("aria-hidden", "true");

  const body = document.createElement("div");
  body.className = "delegate-progress-card-body";

  const head = document.createElement("div");
  head.className = "delegate-progress-card-head";

  const title = document.createElement("div");
  title.className = "delegate-progress-title";
  title.textContent = item.title;

  const time = document.createElement("div");
  time.className = "delegate-progress-time";
  time.textContent = formatTimestamp(item.timestamp) || "";

  head.append(title, time);
  body.append(head);
  appendDelegateProgressText(body, "delegate-progress-meta", item.meta);
  appendDelegateProgressText(body, "thread-text delegate-progress-body", item.text, { rich: true });
  card.append(marker, body);
  return card;
}

function buildDelegateNextCard(item, index) {
  const card = document.createElement("article");
  card.className = `delegate-next-card${item.tone ? ` is-${item.tone}` : ""}`;

  const number = document.createElement("div");
  number.className = "delegate-next-rank";
  number.textContent = String(index + 1);

  const body = document.createElement("div");
  body.className = "delegate-next-body";

  const source = document.createElement("div");
  source.className = "delegate-progress-meta";
  source.textContent = item.source;

  const text = document.createElement("div");
  text.className = "delegate-progress-body";
  text.textContent = item.text;

  body.append(source, text);
  card.append(number, body);
  return card;
}

function buildDelegateProgressSection(titleText, className, emptyText) {
  const section = document.createElement("section");
  section.className = `delegate-progress-section ${className}`;

  const title = document.createElement("div");
  title.className = "delegate-progress-section-title";
  title.textContent = titleText;

  const list = document.createElement("div");
  list.className = "delegate-progress-section-list";

  section.append(title, list);
  if (emptyText) {
    const empty = document.createElement("div");
    empty.className = "history-state-card";
    empty.textContent = emptyText;
    list.append(empty);
  }
  return { section, list };
}

function renderDelegateProgress(project, delegateState, runLog) {
  if (!elements.delegateProgressList) {
    return;
  }

  const model = buildDelegateProgressModel(delegateState, runLog);
  const renderKey = JSON.stringify({
    projectPath: project?.path || "",
    runId: runLog?.runId || delegateState?.status?.runId || "",
    status: delegateState?.status?.state || "",
    activeStep: delegateState?.status?.activeStep || "",
    updatedAt: delegateState?.status?.updatedAt || "",
    done: model.done.map((item) => [item.id, item.timestamp, item.outcome, item.checkpoint, item.validation]),
    working: model.workingNow.map((item) => [item.title, item.timestamp, item.meta, item.text]),
    next: model.nextUp.map((item) => [item.id, item.source, item.text]),
  });
  if (elements.delegateProgressList.dataset.renderKey === renderKey) {
    return;
  }

  clearNode(elements.delegateProgressList);

  const doneSection = buildDelegateProgressSection(
    "Done",
    "is-done",
    model.done.length === 0 ? "Completed steps will appear here as the worker lands them." : "",
  );
  for (const item of model.done.slice().reverse()) {
    doneSection.list.append(buildDelegateDoneCard(item));
  }

  const workingSection = buildDelegateProgressSection(
    "Working Now",
    "is-working",
    model.workingNow.length === 0 ? "No worker step is active right now." : "",
  );
  for (const item of model.workingNow) {
    workingSection.list.append(buildDelegateWorkingCard(item));
  }

  const nextSection = buildDelegateProgressSection("Next Up", "is-next", "");
  for (const [index, item] of model.nextUp.entries()) {
    nextSection.list.append(buildDelegateNextCard(item, index));
  }

  elements.delegateProgressList.append(doneSection.section, workingSection.section, nextSection.section);
  elements.delegateProgressList.dataset.renderKey = renderKey;
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

function normalizeDumpyHandoff(item) {
  if (!item || typeof item !== "object") {
    return null;
  }
  return {
    enabled: item.enabled !== false,
    partyId: String(item.partyId || "").trim(),
    partyName: String(item.partyName || "Dumpy party").trim() || "Dumpy party",
    partyUrl: String(item.partyUrl || "").trim(),
    zipUrl: String(item.zipUrl || "").trim(),
    itemCount: Number.parseInt(String(item.itemCount || "0"), 10) || 0,
    uploadedCount: Number.parseInt(String(item.uploadedCount || "0"), 10) || 0,
    handoffPending: Boolean(item.handoffPending),
    handoffRequestedAt: String(item.handoffRequestedAt || "").trim() || null,
    lastSyncAt: String(item.lastSyncAt || "").trim() || null,
    lastError: String(item.lastError || "").trim(),
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

function attachmentKindFromFile(file) {
  const mimeType = String(file?.type || "").toLowerCase();
  const fileName = String(file?.name || "").toLowerCase();
  return mimeType.startsWith("image/") ||
    /\.(?:gif|heic|heif|jpe?g|png|webp)$/u.test(fileName)
    ? "image"
    : "file";
}

function makeComposerAttachment(file) {
  const kind = attachmentKindFromFile(file);
  return {
    id: makeEntryId(),
    file,
    fileName: String(file?.name || "attachment").trim() || "attachment",
    size: Number(file?.size || 0) || 0,
    mimeType: String(file?.type || "").trim() || "application/octet-stream",
    kind,
    previewUrl: kind === "image" ? URL.createObjectURL(file) : "",
  };
}

function normalizeVoiceInputDeviceId(value) {
  return String(value || "").trim();
}

function restoreVoiceInputDevice() {
  try {
    state.voiceInputDeviceId = normalizeVoiceInputDeviceId(localStorage.getItem(voiceInputDeviceKey));
  } catch {
    state.voiceInputDeviceId = "";
  }
}

function persistVoiceInputDevice() {
  try {
    const deviceId = normalizeVoiceInputDeviceId(state.voiceInputDeviceId);
    if (deviceId) {
      localStorage.setItem(voiceInputDeviceKey, deviceId);
    } else {
      localStorage.removeItem(voiceInputDeviceKey);
    }
  } catch {
    // Ignore storage failures; the current session selection still works.
  }
}

function voiceInputDeviceLabel(deviceId = state.voiceInputDeviceId) {
  const normalized = normalizeVoiceInputDeviceId(deviceId);
  if (!normalized) {
    return "Default microphone";
  }
  const device = state.voiceInputDevices.find((entry) => entry.deviceId === normalized);
  return device?.label || "Selected microphone";
}

function voiceCaptureConstraints() {
  const deviceId = normalizeVoiceInputDeviceId(state.voiceInputDeviceId);
  return deviceId ? { audio: { deviceId: { exact: deviceId } } } : { audio: true };
}

function voiceCaptureFallbackConstraints() {
  return { audio: true };
}

function voiceErrorMessage(error) {
  const name = String(error?.name || "");
  const message = String(error?.message || "").trim();
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Microphone access is blocked. Allow ClawDad in your system's microphone privacy settings.";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "No microphone was found.";
  }
  if (name === "OverconstrainedError" || name === "ConstraintNotSatisfiedError") {
    return "The selected microphone is unavailable.";
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return "The microphone is already in use or could not start.";
  }
  return message || "Voice recording failed.";
}

async function refreshVoiceInputDevices({ requestPermission = false, quiet = false } = {}) {
  if (!navigator.mediaDevices?.enumerateDevices) {
    state.voiceInputDevices = [];
    state.voiceSettingsStatus = "Microphone listing is unavailable in this app view.";
    renderAll();
    return [];
  }

  state.voiceInputDevicesLoading = true;
  if (!quiet) {
    state.voiceSettingsStatus = requestPermission ? "Checking microphone permission..." : "Checking microphones...";
  }
  renderAll();

  let permissionStream = null;
  try {
    if (requestPermission && navigator.mediaDevices?.getUserMedia) {
      permissionStream = await navigator.mediaDevices.getUserMedia(voiceCaptureFallbackConstraints());
    }
    const devices = await navigator.mediaDevices.enumerateDevices();
    const inputs = devices
      .filter((device) => device.kind === "audioinput")
      .map((device, index) => ({
        deviceId: normalizeVoiceInputDeviceId(device.deviceId),
        groupId: normalizeVoiceInputDeviceId(device.groupId),
        label: String(device.label || `Microphone ${index + 1}`).trim(),
      }))
      .filter((device, index, source) =>
        device.deviceId && source.findIndex((candidate) => candidate.deviceId === device.deviceId) === index,
      );
    state.voiceInputDevices = inputs;

    if (state.voiceInputDeviceId && inputs.length > 0 && !inputs.some((entry) => entry.deviceId === state.voiceInputDeviceId)) {
      state.voiceInputDeviceId = "";
      persistVoiceInputDevice();
      state.voiceSettingsStatus = "Selected microphone is unavailable. Using default microphone.";
    } else if (!quiet) {
      state.voiceSettingsStatus = inputs.length > 0
        ? `${inputs.length} microphone${inputs.length === 1 ? "" : "s"} available.`
        : "No microphones found.";
    }
    return inputs;
  } catch (error) {
    state.voiceSettingsStatus = voiceErrorMessage(error);
    if (!quiet) {
      showError(new Error(state.voiceSettingsStatus));
    }
    return [];
  } finally {
    for (const track of permissionStream?.getTracks?.() || []) {
      track.stop();
    }
    state.voiceInputDevicesLoading = false;
    renderAll();
  }
}

function renderVoiceSettings() {
  const select = elements.settingsVoiceInputSelect;
  if (!select) {
    return;
  }

  const selectedDeviceId = normalizeVoiceInputDeviceId(state.voiceInputDeviceId);
  const existingValue = select.value;
  clearNode(select);
  const defaultOption = document.createElement("option");
  defaultOption.value = "";
  defaultOption.textContent = "Default microphone";
  select.append(defaultOption);
  for (const device of state.voiceInputDevices) {
    const option = document.createElement("option");
    option.value = device.deviceId;
    option.textContent = device.label || "Microphone";
    select.append(option);
  }
  select.value = selectedDeviceId && state.voiceInputDevices.some((device) => device.deviceId === selectedDeviceId)
    ? selectedDeviceId
    : "";
  if (existingValue !== select.value) {
    select.dataset.lastValue = select.value;
  }
  select.disabled = state.voiceInputDevicesLoading;

  if (elements.settingsRefreshVoiceDevicesButton) {
    elements.settingsRefreshVoiceDevicesButton.disabled = state.voiceInputDevicesLoading;
    elements.settingsRefreshVoiceDevicesButton.querySelector(".button-text").textContent =
      state.voiceInputDevicesLoading ? "Checking..." : "Refresh Mics";
  }

  const status = state.voiceSettingsStatus ||
    (selectedDeviceId ? `Using ${voiceInputDeviceLabel(selectedDeviceId)}` : "Using system default microphone.");
  setText(elements.settingsVoiceStatus, status, { empty: !status });
}

function renderDesktopAppSettings() {
  const section = elements.settingsDesktopAppSection;
  if (!section) {
    return;
  }
  const available = nativeBridge.isAvailable();
  section.hidden = !available;
  if (!available) {
    return;
  }

  const status = state.desktopAppStatus;
  const updateStatus = status?.updates || {};
  const version = String(status?.version || "").trim();
  const build = String(status?.build || "").trim();
  const runtimeVersion = String(status?.runtimeVersion || "").trim();
  const appVersion = version
    ? `ClawDad ${version}${build ? ` (${build})` : ""}`
    : "ClawDad desktop";
  const versionText = runtimeVersion
    ? `${appVersion} • Runtime ${runtimeVersion}`
    : appVersion;
  setText(elements.settingsDesktopAppVersion, versionText, { empty: false });

  let statusText = state.desktopAppMessage;
  if (!statusText && !status) {
    statusText = "Checking the desktop app...";
  } else if (!statusText && status?.serviceReady !== true) {
    statusText = "The ClawDad service is still starting.";
  } else if (!statusText && updateStatus.canCheckForUpdates === false) {
    statusText = String(updateStatus.message || "Updates are installed from the private release package.");
  } else if (!statusText) {
    statusText = "Desktop service and secure updates are ready.";
  }
  setText(elements.settingsDesktopAppStatus, statusText, { empty: false });
  if (elements.settingsSubscriptionStatus) {
    const entitlement = state.subscriptionEntitlement;
    let entitlementText = state.subscriptionEntitlementStatus;
    if (!entitlementText && entitlement?.active) {
      const expiresAt = formatTimestamp(entitlement.expiresAt);
      entitlementText = entitlement.source === "founding-beta"
        ? "Subscription: founding beta access"
        : `Subscription: active${expiresAt ? ` through ${expiresAt}` : ""}`;
    } else if (!entitlementText && entitlement?.configured) {
      entitlementText = "Subscription: inactive";
    } else if (!entitlementText) {
      entitlementText = "Subscription syncs from the paired iPhone.";
    }
    setText(elements.settingsSubscriptionStatus, entitlementText, {
      empty: false,
    });
  }

  const pending = state.desktopAppPending;
  if (elements.settingsOpenSetupButton) {
    elements.settingsOpenSetupButton.hidden = status?.platform === "windows";
    elements.settingsOpenSetupButton.disabled = Boolean(pending);
  }
  if (elements.settingsCheckUpdatesButton) {
    elements.settingsCheckUpdatesButton.disabled =
      Boolean(pending) || updateStatus.canCheckForUpdates === false;
    setText(
      elements.settingsCheckUpdatesButton.querySelector(".button-text"),
      pending === "updates" ? "Checking..." : "Check for Updates",
    );
  }
  if (elements.settingsOpenLogsButton) {
    elements.settingsOpenLogsButton.disabled =
      Boolean(pending) || status?.logsAvailable === false;
    setText(
      elements.settingsOpenLogsButton.querySelector(".button-text"),
      pending === "logs" ? "Opening..." : "Open Logs",
    );
  }
  if (elements.settingsCopyDiagnosticsButton) {
    elements.settingsCopyDiagnosticsButton.disabled = Boolean(pending);
    setText(
      elements.settingsCopyDiagnosticsButton.querySelector(".button-text"),
      pending === "diagnostics" ? "Copying..." : "Copy Diagnostics",
    );
  }
}

function applyDesktopPlatformCopy() {
  const windows = state.desktopAppStatus?.platform === "windows";
  const primaryRoot = windows
    ? "C:\\Users\\you\\Projects"
    : "/Volumes/Code_2TB/code";
  const additionalRoot = windows
    ? "D:\\Projects"
    : "/Users/cody/Projects";
  for (const input of [
    elements.workspaceRootInput,
    elements.settingsScratchpadInput,
    elements.directoryBrowserPathInput,
  ]) {
    if (input) {
      input.placeholder = primaryRoot;
    }
  }
  if (elements.settingsNewRootInput) {
    elements.settingsNewRootInput.placeholder = additionalRoot;
  }
}

async function refreshDesktopAppStatus({ quiet = false } = {}) {
  if (!nativeBridge.isAvailable()) {
    return;
  }
  if (!quiet) {
    state.desktopAppPending = "status";
    state.desktopAppMessage = "";
    renderAll();
  }
  try {
    state.desktopAppStatus = await nativeBridge.getDesktopAppStatus();
    applyDesktopPlatformCopy();
  } catch (error) {
    state.desktopAppMessage = String(error?.message || "Unable to read desktop app status.");
    if (!quiet) {
      showError(error);
    }
  } finally {
    state.desktopAppPending = "";
    renderAll();
  }
}

function systemSetupIsOpen() {
  return Boolean(
    nativeBridge.isAvailable() &&
    state.systemReadiness &&
    (state.systemSetupForcedOpen || state.systemReadiness.setupRequired),
  );
}

function applySystemReadiness(status = {}) {
  state.systemReadiness = status && typeof status === "object" ? status : null;
  if (!state.systemSetupWorkspaceDraft) {
    state.systemSetupWorkspaceDraft = String(
      state.workspace?.primaryRoot || state.workspace?.suggestions?.[0] || "",
    );
  }
}

function stopSystemSetupPolling() {
  if (state.systemSetupPollTimer) {
    window.clearTimeout(state.systemSetupPollTimer);
    state.systemSetupPollTimer = null;
  }
}

function scheduleSystemSetupPolling() {
  stopSystemSetupPolling();
  if (state.systemReadiness?.install?.state !== "installing") {
    return;
  }
  state.systemSetupPollTimer = window.setTimeout(() => {
    state.systemSetupPollTimer = null;
    void refreshSystemReadiness({ quiet: true });
  }, 1200);
}

async function refreshSystemReadiness({ quiet = false, forceCodexUpdateCheck = false } = {}) {
  if (!nativeBridge.isAvailable() || state.systemSetupPending === "status") {
    return;
  }
  if (!quiet) {
    state.systemSetupPending = "status";
    state.systemSetupStatus = "Checking this Mac…";
    renderAll();
  }
  try {
    applySystemReadiness(await nativeBridge.getSystemReadiness({ forceCodexUpdateCheck }));
    state.systemSetupStatus = "";
  } catch (error) {
    state.systemSetupStatus = String(
      error?.message || "ClawDad could not check this Mac.",
    );
    if (!quiet) {
      showError(error);
    }
  } finally {
    if (state.systemSetupPending === "status") {
      state.systemSetupPending = "";
    }
    scheduleSystemSetupPolling();
    renderAll();
  }
}

async function openSystemSetupAssistant() {
  state.systemSetupForcedOpen = true;
  state.systemSetupStep = 0;
  state.systemSetupStatus = "";
  if (state.settingsModalOpen) {
    closeSettingsModal({ restoreFocus: false });
  }
  await refreshSystemReadiness({ quiet: true });
  renderAll();
  focusSystemSetupStep();
}

function closeSystemSetupAssistant() {
  if (state.systemReadiness?.setupRequired) {
    return false;
  }
  state.systemSetupForcedOpen = false;
  state.systemSetupStep = 0;
  state.systemSetupStatus = "";
  stopSystemSetupPolling();
  renderAll();
  elements.settingsOpenSetupButton?.focus();
  return true;
}

function focusSystemSetupStep() {
  window.requestAnimationFrame(() => {
    const step = [
      elements.systemSetupRoleStep,
      elements.systemSetupRuntimeStep,
      elements.systemSetupWorkspaceStep,
      elements.systemSetupFinishStep,
    ][state.systemSetupStep];
    const heading = step?.querySelector("h2");
    if (heading) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
  });
}

function setSystemSetupStep(nextStep) {
  state.systemSetupStep = Math.max(0, Math.min(3, Number(nextStep) || 0));
  state.systemSetupStatus = "";
  renderAll();
  focusSystemSetupStep();
}

function goBackSystemSetup() {
  if (!systemSetupIsOpen()) {
    return false;
  }
  if (state.systemSetupPending) {
    return true;
  }
  if (state.systemSetupStep > 0) {
    setSystemSetupStep(state.systemSetupStep - 1);
    return true;
  }
  closeSystemSetupAssistant();
  return true;
}

async function selectSystemSetupRole(role) {
  if (!nativeBridge.isAvailable() || state.systemSetupPending) {
    return;
  }
  state.systemSetupPending = "role";
  state.systemSetupStatus = "Saving how this Mac will be used…";
  renderAll();
  try {
    applySystemReadiness(await nativeBridge.setComputerRole(role));
    state.systemSetupStatus = "";
  } catch (error) {
    state.systemSetupStatus = String(error?.message || "The computer role could not be saved.");
    showError(error);
  } finally {
    state.systemSetupPending = "";
    renderAll();
  }
}

async function startSystemSetupCodexInstall() {
  if (!nativeBridge.isAvailable() || state.systemSetupPending) {
    return;
  }
  const isUpdate = state.systemReadiness?.codex?.installed === true;
  state.systemSetupPending = "install";
  state.systemSetupStatus = isUpdate
    ? "Starting the official Codex updater…"
    : "Starting the official Codex installer…";
  renderAll();
  try {
    await nativeBridge.installCodex();
    state.systemSetupStatus = isUpdate
      ? "Codex is updating. ClawDad will refresh automatically."
      : "Codex is installing. ClawDad will refresh automatically.";
    await refreshSystemReadiness({ quiet: true });
  } catch (error) {
    state.systemSetupStatus = String(error?.message || "Codex installation could not start.");
    showError(error);
  } finally {
    state.systemSetupPending = "";
    scheduleSystemSetupPolling();
    renderAll();
  }
}

async function openSystemSetupCodexLogin() {
  if (!nativeBridge.isAvailable() || state.systemSetupPending) {
    return;
  }
  state.systemSetupPending = "login";
  state.systemSetupStatus = "Opening the Codex sign-in window…";
  renderAll();
  try {
    await nativeBridge.openCodexLogin();
    state.systemSetupStatus = "Finish signing in with ChatGPT, return here, then click Refresh.";
  } catch (error) {
    state.systemSetupStatus = String(error?.message || "Codex sign in could not open.");
    showError(error);
  } finally {
    state.systemSetupPending = "";
    renderAll();
  }
}

async function chooseSystemSetupWorkspace() {
  if (!nativeBridge.isAvailable() || state.systemSetupPending) {
    return;
  }
  state.systemSetupPending = "workspace-picker";
  state.systemSetupStatus = "Opening the folder picker…";
  renderAll();
  try {
    const result = await nativeBridge.chooseFolder({
      purpose: "setup",
      defaultPath: state.systemSetupWorkspaceDraft || state.workspace?.suggestions?.[0] || "",
    });
    if (!result?.cancelled && result?.path) {
      state.systemSetupWorkspaceDraft = String(result.path);
      state.systemSetupStatus = "";
    }
  } catch (error) {
    state.systemSetupStatus = String(error?.message || "The folder picker could not open.");
    showError(error);
  } finally {
    state.systemSetupPending = "";
    renderAll();
  }
}

async function saveSystemSetupWorkspace() {
  if (state.systemReadiness?.needsLocalCodex !== true) {
    return true;
  }
  const primaryRoot = state.systemSetupWorkspaceDraft.trim();
  if (!primaryRoot) {
    state.systemSetupStatus = "Choose the folder that will contain this Mac's projects.";
    renderAll();
    return false;
  }
  state.systemSetupPending = "workspace";
  state.systemSetupStatus = "Saving this Mac's project home…";
  renderAll();
  try {
    const payload = await fetchJson("/v1/workspace", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        primaryRoot,
        projectRoots: [primaryRoot],
      }),
    });
    applyWorkspacePayload(payload.workspace);
    state.systemSetupWorkspaceDraft = String(payload.workspace?.primaryRoot || primaryRoot);
    state.systemSetupStatus = "";
    await refreshProjectRoots();
    await refreshProjects();
    return true;
  } catch (error) {
    state.systemSetupStatus = String(error?.message || "The project home could not be saved.");
    showError(error);
    return false;
  } finally {
    state.systemSetupPending = "";
    renderAll();
  }
}

async function advanceSystemSetup() {
  if (!systemSetupIsOpen() || state.systemSetupPending) {
    return;
  }
  if (state.systemSetupStep === 0) {
    setSystemSetupStep(1);
    return;
  }
  if (state.systemSetupStep === 1) {
    if (state.systemReadiness?.canComplete !== true) {
      state.systemSetupStatus = state.systemReadiness?.needsLocalCodex
        ? "Install Codex and sign in with ChatGPT to continue."
        : "The managed ClawDad runtime is still being checked.";
      renderAll();
      return;
    }
    setSystemSetupStep(2);
    return;
  }
  if (state.systemSetupStep === 2) {
    if (await saveSystemSetupWorkspace()) {
      setSystemSetupStep(3);
    }
    return;
  }

  state.systemSetupPending = "complete";
  state.systemSetupStatus = "Finishing setup…";
  renderAll();
  try {
    applySystemReadiness(await nativeBridge.completeSystemSetup());
    state.systemSetupForcedOpen = false;
    state.systemSetupStep = 0;
    state.systemSetupStatus = "";
    stopSystemSetupPolling();
  } catch (error) {
    state.systemSetupStatus = String(error?.message || "Setup could not be completed.");
    showError(error);
  } finally {
    state.systemSetupPending = "";
    renderAll();
  }
}

function setSystemReadinessState(element, label, { ready = false, error = false } = {}) {
  if (!element) {
    return;
  }
  element.textContent = label;
  element.classList.toggle("is-ready", ready);
  element.classList.toggle("is-error", error);
}

function renderSystemSetupAssistant() {
  if (!elements.systemSetupModal) {
    return;
  }
  const open = systemSetupIsOpen();
  elements.systemSetupModal.hidden = !open;
  if (!open) {
    return;
  }

  const readiness = state.systemReadiness || {};
  const role = String(readiness.role || "both");
  const needsCodex = readiness.needsLocalCodex === true;
  const node = readiness.node || {};
  const orp = readiness.orp || {};
  const codex = readiness.codex || {};
  const codexUpdate = codex.update || {};
  const install = readiness.install || {};
  const steps = [
    elements.systemSetupRoleStep,
    elements.systemSetupRuntimeStep,
    elements.systemSetupWorkspaceStep,
    elements.systemSetupFinishStep,
  ];
  steps.forEach((step, index) => {
    if (step) {
      step.hidden = index !== state.systemSetupStep;
    }
  });
  setText(elements.systemSetupProgress, `${state.systemSetupStep + 1} of 4`, { empty: false });

  const canClose = readiness.setupRequired !== true && state.systemSetupStep === 0;
  if (elements.systemSetupBackButton) {
    elements.systemSetupBackButton.disabled = state.systemSetupPending || (state.systemSetupStep === 0 && !canClose);
    const backLabel = elements.systemSetupBackButton.querySelector("span:last-child");
    if (backLabel) {
      backLabel.textContent = canClose ? "Close" : "Back";
    }
  }
  for (const button of elements.systemSetupRoleButtons) {
    const selected = button.dataset.systemRole === role;
    button.setAttribute("aria-checked", selected ? "true" : "false");
    button.disabled = Boolean(state.systemSetupPending);
  }

  setText(
    elements.systemSetupNodeDetail,
    node.ready ? `${node.version || "Bundled"} • maintained by ClawDad` : "Managed Node is missing from this app build.",
    { empty: false },
  );
  setSystemReadinessState(elements.systemSetupNodeState, node.ready ? "Ready" : "Repair needed", {
    ready: node.ready === true,
    error: node.ready !== true,
  });
  setText(
    elements.systemSetupOrpDetail,
    orp.ready ? "Bundled with the ClawDad runtime" : "Managed ORP is missing from this app build.",
    { empty: false },
  );
  setSystemReadinessState(elements.systemSetupOrpState, orp.ready ? "Ready" : "Repair needed", {
    ready: orp.ready === true,
    error: orp.ready !== true,
  });

  if (elements.systemSetupCodexRow) {
    elements.systemSetupCodexRow.hidden = !needsCodex;
  }
  if (elements.systemSetupCodexActions) {
    elements.systemSetupCodexActions.hidden = !needsCodex;
  }
  const codexUsable = codex.installed === true && codex.loggedIn === true;
  const codexUpdateAvailable = codexUpdate.state === "available" && codexUpdate.available === true;
  const codexUpdateCurrent = codexUpdate.state === "current";
  const codexVersion = codex.installedVersion || codex.version || "Codex";
  let codexDetail = "Install the official standalone Codex CLI into ~/.local/bin.";
  if (codex.installed) {
    const detailParts = [codexVersion];
    detailParts.push(codex.loggedIn ? "signed in" : "sign in with ChatGPT");
    if (codexUpdateAvailable) {
      detailParts.push(`${codexUpdate.latestVersion || "new release"} available`);
    } else if (codexUpdateCurrent) {
      detailParts.push("current release");
    } else {
      detailParts.push("update status unavailable");
    }
    if (codex.loggedIn) {
      detailParts.push(`shared ${codex.home || "~/.codex"}`);
    }
    codexDetail = detailParts.join(" • ");
  }
  setText(
    elements.systemSetupCodexDetail,
    codexDetail,
    { empty: false },
  );
  let codexStateLabel = "Install";
  let codexStateReady = false;
  if (codex.installed && !codex.loggedIn) {
    codexStateLabel = "Sign in";
  } else if (codexUsable && codexUpdateAvailable) {
    codexStateLabel = "Update available";
  } else if (codexUsable && codexUpdateCurrent) {
    codexStateLabel = "Up to date";
    codexStateReady = true;
  } else if (codexUsable) {
    codexStateLabel = "Installed & signed in";
    codexStateReady = true;
  }
  setSystemReadinessState(
    elements.systemSetupCodexState,
    codexStateLabel,
    { ready: codexStateReady, error: false },
  );
  if (elements.systemSetupInstallCodexButton) {
    const updaterDisabled = codex.installed === true && codexUpdateCurrent;
    elements.systemSetupInstallCodexButton.disabled =
      Boolean(state.systemSetupPending) || updaterDisabled || install.state === "installing";
    elements.systemSetupInstallCodexButton.textContent = install.state === "installing"
      ? codex.installed ? "Updating Codex…" : "Installing Codex…"
      : codex.installed
        ? codexUpdateAvailable
          ? `Update to ${codexUpdate.latestVersion || "latest"}`
          : codexUpdateCurrent
            ? "Codex is current"
            : "Run official updater"
        : "Install official Codex";
  }
  if (elements.systemSetupLoginCodexButton) {
    elements.systemSetupLoginCodexButton.disabled =
      Boolean(state.systemSetupPending) || codex.installed !== true || codex.loggedIn === true;
    elements.systemSetupLoginCodexButton.textContent = codex.loggedIn
      ? "Signed in"
      : "Sign in with ChatGPT";
  }
  if (elements.systemSetupRefreshButton) {
    elements.systemSetupRefreshButton.disabled = Boolean(state.systemSetupPending);
    elements.systemSetupRefreshButton.textContent = codex.installed
      ? "Check again"
      : "Refresh";
  }
  setText(
    elements.systemSetupRuntimeStatus,
    String(install.message || codexUpdate.message || (needsCodex ? "ClawDad checks login status without reading your credentials." : "Local Codex is optional for a controller-only Mac.")),
    { empty: false },
  );

  const folderRow = elements.systemSetupWorkspaceInput?.closest(".system-setup-folder-row");
  if (folderRow) {
    folderRow.hidden = !needsCodex;
  }
  setText(
    elements.systemSetupWorkspaceText,
    needsCodex
      ? "New project directories and local Codex threads will be scoped to this Mac and this folder."
      : "This controller keeps each paired computer's own projects and Codex threads separate. You can add a computer after setup.",
    { empty: false },
  );
  if (elements.systemSetupWorkspaceInput && elements.systemSetupWorkspaceInput.value !== state.systemSetupWorkspaceDraft) {
    elements.systemSetupWorkspaceInput.value = state.systemSetupWorkspaceDraft;
  }
  if (elements.systemSetupWorkspaceInput) {
    elements.systemSetupWorkspaceInput.disabled = Boolean(state.systemSetupPending);
  }
  if (elements.systemSetupWorkspaceChooseButton) {
    elements.systemSetupWorkspaceChooseButton.disabled = Boolean(state.systemSetupPending);
  }
  setText(elements.systemSetupWorkspaceStatus, state.systemSetupStatus, {
    empty: !state.systemSetupStatus,
  });
  setText(
    elements.systemSetupFinishText,
    needsCodex
      ? "This Mac is ready for local Codex threads, paired controllers, and Remote Assist."
      : "This Mac is ready to pair with another ClawDad computer and control its workspace.",
    { empty: false },
  );

  let nextLabel = "Continue";
  let nextDisabled = Boolean(state.systemSetupPending);
  if (state.systemSetupStep === 1 && readiness.canComplete !== true) {
    nextDisabled = true;
  } else if (state.systemSetupStep === 2) {
    nextLabel = needsCodex ? "Save & Continue" : "Continue";
    if (needsCodex && !state.systemSetupWorkspaceDraft.trim()) {
      nextDisabled = true;
    }
  } else if (state.systemSetupStep === 3) {
    nextLabel = "Finish Setup";
  }
  if (elements.systemSetupNextButton) {
    elements.systemSetupNextButton.disabled = nextDisabled;
    elements.systemSetupNextButton.textContent = state.systemSetupPending === "complete"
      ? "Finishing…"
      : nextLabel;
  }
  setText(
    elements.systemSetupFooterStatus,
    state.systemSetupStep === 2 ? "" : state.systemSetupStatus,
    { empty: state.systemSetupStep === 2 || !state.systemSetupStatus },
  );
}

async function refreshSubscriptionEntitlement() {
  try {
    const payload = await fetchJson("/v1/cloud/entitlement");
    state.subscriptionEntitlement = payload.entitlement || null;
    state.subscriptionEntitlementStatus = "";
  } catch (error) {
    state.subscriptionEntitlementStatus =
      String(error?.message || "Subscription status is unavailable.");
  } finally {
    renderAll();
  }
}

async function checkDesktopAppUpdates() {
  if (!nativeBridge.isAvailable() || state.desktopAppPending) {
    return;
  }
  state.desktopAppPending = "updates";
  state.desktopAppMessage = "Opening the secure update check...";
  renderAll();
  try {
    state.desktopAppStatus = await nativeBridge.checkForUpdates();
    state.desktopAppMessage = "Update check opened.";
  } catch (error) {
    state.desktopAppMessage = String(error?.message || "Unable to check for updates.");
    showError(error);
  } finally {
    state.desktopAppPending = "";
    renderAll();
  }
}

async function openDesktopAppLogs() {
  if (!nativeBridge.isAvailable() || state.desktopAppPending) {
    return;
  }
  state.desktopAppPending = "logs";
  state.desktopAppMessage = "";
  renderAll();
  try {
    await nativeBridge.openLogs();
    state.desktopAppMessage = state.desktopAppStatus?.platform === "windows"
      ? "Logs opened in File Explorer."
      : "Logs opened in Finder.";
  } catch (error) {
    state.desktopAppMessage = String(error?.message || "Unable to open logs.");
    showError(error);
  } finally {
    state.desktopAppPending = "";
    renderAll();
  }
}

async function copyDesktopAppDiagnostics() {
  if (!nativeBridge.isAvailable() || state.desktopAppPending) {
    return;
  }
  state.desktopAppPending = "diagnostics";
  state.desktopAppMessage = "";
  renderAll();
  try {
    const result = await nativeBridge.copyDiagnostics();
    await copyText(result?.text || "");
    state.desktopAppMessage = "Privacy-safe diagnostics copied.";
  } catch (error) {
    state.desktopAppMessage = String(error?.message || "Unable to copy diagnostics.");
    showError(error);
  } finally {
    state.desktopAppPending = "";
    renderAll();
  }
}

function renderRemoteAssistSettings() {
  const section = elements.settingsRemoteAssistSection;
  if (!section) {
    return;
  }
  const available = nativeBridge.isAvailable();
  section.hidden = !available;
  if (!available) {
    return;
  }

  const status = state.remoteAssistStatus;
  const pending = state.remoteAssistPending;
  const windows = status?.platform === "windows" ||
    state.desktopAppStatus?.platform === "windows";
  const screenAllowed = status?.screenRecordingGranted === true;
  const controlAllowed = status?.accessibilityGranted === true;

  setText(
    elements.settingsRemoteAssistSubhead,
    windows
      ? "Open this Windows computer from a paired ClawDad device"
      : "Open this Mac from an iPhone or another Mac",
    { empty: false },
  );
  if (elements.settingsRemoteAssistMacHelp) {
    elements.settingsRemoteAssistMacHelp.hidden = windows;
  }
  if (elements.settingsRemoteAssistWindowsHelp) {
    elements.settingsRemoteAssistWindowsHelp.hidden = !windows;
  }
  if (elements.settingsRemoteAssistPermissionGrid) {
    elements.settingsRemoteAssistPermissionGrid.hidden = windows;
  }

  if (elements.settingsRemoteAssistToggle) {
    elements.settingsRemoteAssistToggle.checked = status?.enabled === true;
    elements.settingsRemoteAssistToggle.disabled = pending || !status;
  }
  setText(
    elements.settingsRemoteAssistStatus,
    pending ? "Updating Remote Assist..." : String(status?.message || "Checking Remote Assist..."),
    { empty: false },
  );

  if (elements.settingsRemoteAssistInfoButton) {
    elements.settingsRemoteAssistInfoButton.setAttribute(
      "aria-expanded",
      String(state.remoteAssistInfoOpen),
    );
    setText(
      elements.settingsRemoteAssistInfoButton.querySelector(".button-text"),
      state.remoteAssistInfoOpen ? "Hide Info" : "More Info",
    );
  }
  if (elements.settingsRemoteAssistInfo) {
    elements.settingsRemoteAssistInfo.hidden = !state.remoteAssistInfoOpen;
  }

  setText(
    elements.settingsRemoteAssistScreenState,
    screenAllowed ? "Allowed" : "Required",
  );
  elements.settingsRemoteAssistScreenState?.classList.toggle("is-allowed", screenAllowed);
  if (elements.settingsRemoteAssistScreenButton) {
    elements.settingsRemoteAssistScreenButton.disabled = pending || screenAllowed;
  }

  setText(
    elements.settingsRemoteAssistControlState,
    controlAllowed ? "Allowed" : "Required",
  );
  elements.settingsRemoteAssistControlState?.classList.toggle("is-allowed", controlAllowed);
  if (elements.settingsRemoteAssistControlButton) {
    elements.settingsRemoteAssistControlButton.disabled = pending || controlAllowed;
  }

  if (elements.settingsRemoteAssistStopButton) {
    elements.settingsRemoteAssistStopButton.hidden = status?.active !== true;
    elements.settingsRemoteAssistStopButton.disabled = pending;
  }
}

async function refreshRemoteAssistStatus({ quiet = false } = {}) {
  if (!nativeBridge.isAvailable()) {
    return;
  }
  if (!quiet) {
    state.remoteAssistPending = true;
    renderAll();
  }
  try {
    state.remoteAssistStatus = await nativeBridge.getRemoteAssistStatus();
  } catch (error) {
    if (!quiet) {
      showError(error);
    }
  } finally {
    state.remoteAssistPending = false;
    renderAll();
  }
}

async function setRemoteAssistEnabled(enabled) {
  if (!nativeBridge.isAvailable() || state.remoteAssistPending) {
    return;
  }
  state.remoteAssistPending = true;
  renderAll();
  try {
    state.remoteAssistStatus = await nativeBridge.setRemoteAssistEnabled(enabled);
  } catch (error) {
    showError(error);
  } finally {
    state.remoteAssistPending = false;
    renderAll();
  }
}

async function openRemoteAssistPrivacy(pane) {
  if (!nativeBridge.isAvailable() || state.remoteAssistPending) {
    return;
  }
  state.remoteAssistPending = true;
  renderAll();
  try {
    state.remoteAssistStatus = await nativeBridge.openRemoteAssistPrivacy(pane);
  } catch (error) {
    showError(error);
  } finally {
    state.remoteAssistPending = false;
    renderAll();
  }
}

async function stopRemoteAssist() {
  if (!nativeBridge.isAvailable() || state.remoteAssistPending) {
    return;
  }
  state.remoteAssistPending = true;
  renderAll();
  try {
    state.remoteAssistStatus = await nativeBridge.stopRemoteAssist();
  } catch (error) {
    showError(error);
  } finally {
    state.remoteAssistPending = false;
    renderAll();
  }
}

function setRemoteAssistInfoOpen(open, { restoreFocus = false } = {}) {
  state.remoteAssistInfoOpen = Boolean(open);
  renderRemoteAssistSettings();
  if (restoreFocus) {
    window.requestAnimationFrame(() => {
      elements.settingsRemoteAssistInfoButton?.focus();
    });
  }
}

async function getVoiceRecordingStream() {
  const selectedDeviceId = normalizeVoiceInputDeviceId(state.voiceInputDeviceId);
  try {
    const stream = await navigator.mediaDevices.getUserMedia(voiceCaptureConstraints());
    void refreshVoiceInputDevices({ quiet: true });
    return stream;
  } catch (error) {
    if (
      selectedDeviceId &&
      ["NotFoundError", "DevicesNotFoundError", "OverconstrainedError", "ConstraintNotSatisfiedError"].includes(String(error?.name || ""))
    ) {
      state.voiceInputDeviceId = "";
      persistVoiceInputDevice();
      state.voiceSettingsStatus = "Selected microphone is unavailable. Retrying with default microphone.";
      renderAll();
      const stream = await navigator.mediaDevices.getUserMedia(voiceCaptureFallbackConstraints());
      void refreshVoiceInputDevices({ quiet: true });
      return stream;
    }
    throw error;
  }
}

function voiceRecordingSupported() {
  return Boolean(
    window.isSecureContext &&
      navigator.mediaDevices?.getUserMedia &&
      typeof window.MediaRecorder === "function",
  );
}

function preferredVoiceMimeType() {
  const mediaRecorder = window.MediaRecorder;
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/mpeg",
  ];
  if (!mediaRecorder?.isTypeSupported) {
    return "";
  }
  return candidates.find((candidate) => mediaRecorder.isTypeSupported(candidate)) || "";
}

function stopVoiceStream() {
  for (const track of state.voiceStream?.getTracks?.() || []) {
    track.stop();
  }
  state.voiceStream = null;
}

function setVoiceState(nextState, error = "") {
  state.voiceState = nextState;
  state.voiceError = String(error || "");
  updateComposerVoiceButton();
}

function updateComposerVoiceButton() {
  const button = elements.composerVoiceButton;
  if (!button) {
    return;
  }
  const recording = state.voiceState === "recording";
  const transcribing = state.voiceState === "transcribing";
  const disabled = transcribing || state.dispatchPending;
  const inputLabel = state.voiceActiveInputLabel || voiceInputDeviceLabel();
  button.classList.toggle("is-recording", recording);
  button.classList.toggle("is-loading", transcribing);
  button.disabled = disabled;
  button.setAttribute(
    "aria-label",
    transcribing
      ? "Transcribing voice message"
      : recording
        ? "Stop recording voice message"
        : "Record voice message",
  );
  button.setAttribute("aria-pressed", String(recording));
  button.title = transcribing
    ? "Transcribing voice message"
    : recording
      ? `Stop recording from ${inputLabel}`
      : `Record voice message with ${inputLabel}`;
  const label = button.querySelector(".button-text");
  if (label) {
    label.textContent = transcribing ? "Transcribing" : recording ? "Stop talking" : "Talk";
  }
}

function insertTranscriptIntoComposer(text) {
  const transcript = String(text || "").trim();
  if (!transcript || !elements.messageInput) {
    return;
  }
  const current = String(elements.messageInput.value || "").trim();
  elements.messageInput.value = current ? `${current}\n\n${transcript}` : transcript;
  elements.messageInput.focus();
  elements.messageInput.setSelectionRange(elements.messageInput.value.length, elements.messageInput.value.length);
  updateSendAvailability();
}

async function transcribeComposerVoice(blob, { fileName = "clawdad-voice.webm", mimeType = "" } = {}) {
  if (!blob || Number(blob.size || 0) <= 0) {
    setVoiceState("idle");
    return;
  }
  setVoiceState("transcribing");
  try {
    const formData = new FormData();
    if (state.selectedProject) {
      formData.append("project", state.selectedProject);
    }
    formData.append("audio", blob, fileName || "clawdad-voice.webm");
    const payload = await fetchJson("/v1/stt/transcribe", {
      method: "POST",
      body: formData,
    });
    insertTranscriptIntoComposer(payload.text || payload.transcript || "");
    setVoiceState("idle");
  } catch (error) {
    setVoiceState("idle", error.message);
    showError(error);
  } finally {
    renderAll();
  }
}

async function startVoiceRecording() {
  if (!voiceRecordingSupported()) {
    elements.composerVoiceCaptureInput?.click();
    return;
  }
  if (state.voiceState === "transcribing") {
    return;
  }

  try {
    const stream = await getVoiceRecordingStream();
    const mimeType = preferredVoiceMimeType();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    state.voiceStream = stream;
    state.voiceChunks = [];
    state.voiceRecorder = recorder;
    state.voiceActiveInputLabel = stream.getAudioTracks?.()[0]?.label || voiceInputDeviceLabel();

    recorder.addEventListener("dataavailable", (event) => {
      if (event.data?.size > 0) {
        state.voiceChunks.push(event.data);
      }
    });
    recorder.addEventListener("stop", () => {
      const chunks = [...state.voiceChunks];
      state.voiceChunks = [];
      state.voiceRecorder = null;
      state.voiceActiveInputLabel = "";
      stopVoiceStream();
      const type = mimeType || chunks[0]?.type || "audio/webm";
      const blob = new Blob(chunks, { type });
      void transcribeComposerVoice(blob, {
        fileName: type.includes("mp4") ? "clawdad-voice.mp4" : "clawdad-voice.webm",
        mimeType: type,
      });
    }, { once: true });
    recorder.addEventListener("error", (event) => {
      stopVoiceStream();
      state.voiceRecorder = null;
      state.voiceActiveInputLabel = "";
      setVoiceState("idle", voiceErrorMessage(event.error) || "Voice recording failed");
      showError(new Error(state.voiceError || "Voice recording failed"));
    }, { once: true });

    recorder.start();
    setVoiceState("recording");
    if (state.voiceActiveInputLabel) {
      showAudioStatus(`Recording with ${state.voiceActiveInputLabel}`);
    }
  } catch (error) {
    stopVoiceStream();
    state.voiceRecorder = null;
    state.voiceActiveInputLabel = "";
    const message = voiceErrorMessage(error);
    setVoiceState("idle", message);
    state.voiceSettingsStatus = message;
    showError(new Error(message));
  } finally {
    renderAll();
  }
}

function stopVoiceRecording() {
  const recorder = state.voiceRecorder;
  if (!recorder || recorder.state === "inactive") {
    setVoiceState("idle");
    state.voiceActiveInputLabel = "";
    stopVoiceStream();
    renderAll();
    return;
  }
  setVoiceState("transcribing");
  recorder.stop();
  renderAll();
}

function handleComposerVoiceButtonClick() {
  if (state.voiceState === "recording") {
    stopVoiceRecording();
    return;
  }
  void startVoiceRecording();
}

function composerAttachmentSummary(attachment) {
  return {
    id: String(attachment?.id || "").trim() || makeEntryId(),
    fileName: String(attachment?.fileName || "attachment").trim() || "attachment",
    size: Number(attachment?.size || 0) || 0,
    mimeType: String(attachment?.mimeType || "").trim() || "application/octet-stream",
    kind: String(attachment?.kind || "").trim() || "file",
  };
}

function revokeComposerAttachment(attachment) {
  if (attachment?.previewUrl) {
    URL.revokeObjectURL(attachment.previewUrl);
  }
}

function clearComposerAttachments() {
  for (const attachment of state.composerAttachments) {
    revokeComposerAttachment(attachment);
  }
  state.composerAttachments = [];
  if (elements.composerAttachmentInput) {
    elements.composerAttachmentInput.value = "";
  }
}

function addComposerFiles(files) {
  const nextFiles = [...(files || [])].filter(Boolean);
  if (nextFiles.length === 0) {
    return;
  }
  state.composerAttachments = [
    ...state.composerAttachments,
    ...nextFiles.map(makeComposerAttachment),
  ];
  renderComposerAttachments();
  updateSendAvailability();
}

function removeComposerAttachment(attachmentId) {
  const attachment = state.composerAttachments.find((item) => item.id === attachmentId);
  revokeComposerAttachment(attachment);
  state.composerAttachments = state.composerAttachments.filter((item) => item.id !== attachmentId);
  if (elements.composerAttachmentInput) {
    elements.composerAttachmentInput.value = "";
  }
  renderComposerAttachments();
  updateSendAvailability();
}

function buildMessageAttachmentList(attachments) {
  const normalized = normalizeHistoryAttachments(attachments);
  if (normalized.length === 0) {
    return null;
  }

  const list = document.createElement("div");
  list.className = "message-attachment-list";
  for (const attachment of normalized) {
    const chip = document.createElement("span");
    chip.className = "message-attachment-chip";

    const kind = document.createElement("span");
    kind.className = "message-attachment-kind";
    kind.textContent = attachment.kind === "image" ? "IMG" : "FILE";

    const name = document.createElement("span");
    name.className = "message-attachment-name";
    name.textContent = `${attachment.fileName} · ${formatFileSize(attachment.size)}`;

    chip.append(kind, name);
    list.append(chip);
  }
  return list;
}

function renderComposerAttachments() {
  if (!elements.composerAttachmentList) {
    return;
  }
  clearNode(elements.composerAttachmentList);
  elements.composerAttachmentList.hidden = state.composerAttachments.length === 0;

  for (const attachment of state.composerAttachments) {
    const card = document.createElement("div");
    card.className = "composer-attachment-card";

    if (attachment.kind === "image" && attachment.previewUrl) {
      const preview = document.createElement("img");
      preview.className = "composer-attachment-thumb";
      preview.src = attachment.previewUrl;
      preview.alt = "";
      card.append(preview);
    } else {
      const fileIcon = document.createElement("div");
      fileIcon.className = "composer-attachment-file-icon";
      fileIcon.textContent = "FILE";
      card.append(fileIcon);
    }

    const meta = document.createElement("div");
    meta.className = "composer-attachment-meta";

    const name = document.createElement("div");
    name.className = "composer-attachment-name";
    name.textContent = attachment.fileName;

    const detail = document.createElement("div");
    detail.className = "composer-attachment-detail";
    detail.textContent = `${attachment.kind === "image" ? "Image" : "File"} · ${formatFileSize(attachment.size)}`;

    meta.append(name, detail);

    const removeButton = document.createElement("button");
    removeButton.className = "thread-button composer-attachment-remove";
    removeButton.type = "button";
    removeButton.dataset.removeAttachment = attachment.id;
    removeButton.setAttribute("aria-label", `Remove ${attachment.fileName}`);
    removeButton.textContent = "×";

    card.append(meta, removeButton);
    elements.composerAttachmentList.append(card);
  }
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

function buildArtifactCard(artifact, { compact = false, projectLabel = "" } = {}) {
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
  pathLabel.textContent = [projectLabel, artifact.relativePath].filter(Boolean).join(" • ");

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

function buildDumpyHandoffCard(dumpy) {
  const card = document.createElement("article");
  card.className = "artifact-card is-compact dumpy-handoff-card";

  const head = document.createElement("div");
  head.className = "artifact-head";

  const name = document.createElement("div");
  name.className = "artifact-name";
  name.textContent = dumpy.partyName || "Dumpy party";

  const meta = document.createElement("div");
  meta.className = "artifact-meta";
  meta.textContent = [
    dumpy.itemCount > 0 ? `${dumpy.itemCount} dump${dumpy.itemCount === 1 ? "" : "s"}` : "",
    dumpy.lastSyncAt ? `synced ${formatTimestamp(dumpy.lastSyncAt)}` : "",
  ].filter(Boolean).join(" • ") || (dumpy.handoffPending ? "Waiting for requested files" : "Ready");

  head.append(name, meta);

  const pathLabel = document.createElement("div");
  pathLabel.className = "artifact-path";
  pathLabel.textContent = dumpy.lastError
    ? `Dumpy sync needs attention: ${dumpy.lastError}`
    : "Requested files from this project land in this Dumpy party.";

  const actions = document.createElement("div");
  actions.className = "artifact-actions";

  const open = document.createElement("button");
  open.className = "artifact-action-button";
  open.type = "button";
  open.disabled = !dumpy.partyUrl;
  open.textContent = "Open in Dumpy";
  open.addEventListener("click", () => {
    if (dumpy.partyUrl) {
      window.open(dumpy.partyUrl, "_blank", "noopener,noreferrer");
    }
  });
  actions.append(open);

  if (dumpy.zipUrl) {
    const zip = document.createElement("a");
    zip.className = "artifact-action";
    zip.href = dumpy.zipUrl;
    zip.textContent = "Download zip";
    zip.setAttribute("download", `${dumpy.partyName || "dump-party"}.zip`);
    actions.append(zip);
  }

  card.append(head, pathLabel, actions);
  return card;
}

function renderArtifactShelf() {
  const project = currentProject();
  const artifactState = artifactsStateFor(project?.path || "");
  const dumpy = normalizeDumpyHandoff(artifactState.dumpy);
  const itemCount = Number(dumpy?.itemCount || 0) || 0;

  if (elements.projectArtifactsOrb) {
    elements.projectArtifactsOrb.hidden = itemCount === 0;
  }
  if (elements.projectArtifactsButton) {
    elements.projectArtifactsButton.title =
      itemCount > 0 ? `${itemCount} agent file${itemCount === 1 ? "" : "s"}` : "Files";
  }
  const visible = Boolean(dumpy && (itemCount > 0 || dumpy.lastError));
  if (elements.artifactShelf) {
    elements.artifactShelf.hidden = !visible;
    elements.artifactShelf.classList.toggle("is-collapsed", state.artifactShelfCollapsed);
    elements.artifactShelf.classList.toggle("has-error", Boolean(dumpy?.lastError));
  }
  if (elements.artifactShelfTitle) {
    elements.artifactShelfTitle.textContent = "Dumpy party";
  }
  if (elements.artifactShelfMeta) {
    elements.artifactShelfMeta.textContent = dumpy?.lastError
      ? "SYNC NEEDS ATTENTION"
      : itemCount > 0
        ? `${itemCount} DUMP${itemCount === 1 ? "" : "S"} READY`
        : dumpy?.handoffPending
          ? "WAITING FOR FILES"
          : "";
  }
  if (elements.artifactShelfOpenButton) {
    elements.artifactShelfOpenButton.disabled = !dumpy?.partyUrl;
    elements.artifactShelfOpenButton.dataset.dumpyUrl = dumpy?.partyUrl || "";
    elements.artifactShelfOpenButton.textContent = "Open Dumpy";
  }
  if (elements.artifactShelfToggle) {
    elements.artifactShelfToggle.setAttribute("aria-expanded", String(!state.artifactShelfCollapsed));
    elements.artifactShelfToggle.setAttribute(
      "aria-label",
      `${state.artifactShelfCollapsed ? "Expand" : "Collapse"} Dumpy party`,
    );
  }
  if (elements.artifactShelfList) {
    clearNode(elements.artifactShelfList);
    if (visible) {
      elements.artifactShelfList.append(buildDumpyHandoffCard(dumpy));
      elements.artifactShelfList.dataset.renderKey = JSON.stringify(dumpy);
    } else {
      elements.artifactShelfList.dataset.renderKey = "";
    }
  }
}

function projectLabelForPath(projectPath = "") {
  const project = projectByPath(projectPath);
  return project?.displayName || project?.slug || fallbackProjectLabel(projectPath);
}

function allArtifactItems() {
  const items = [];
  for (const [projectPath, artifactState] of Object.entries(state.artifactsByProject)) {
    for (const artifact of Array.isArray(artifactState?.items) ? artifactState.items : []) {
      items.push({
        ...artifact,
        projectPath: artifact.projectPath || projectPath,
      });
    }
  }
  return items.sort((left, right) => {
    const leftTime = Date.parse(left.modifiedAt || "");
    const rightTime = Date.parse(right.modifiedAt || "");
    return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
  });
}

function renderFilesWorkspace() {
  if (!elements.filesWorkspaceList) {
    return;
  }

  const projectCount = state.projects.length;
  const artifactStates = Object.values(state.artifactsByProject);
  const loadingCount = artifactStates.filter((artifactState) => artifactState?.loading).length;
  const items = allArtifactItems();
  const catalogBlocking = catalogBlocksInteraction();
  const catalogRefreshing = catalogIsRefreshing();

  if (elements.filesWorkspaceMeta) {
    elements.filesWorkspaceMeta.textContent =
      projectCount > 0
        ? `${items.length} file${items.length === 1 ? "" : "s"} across ${projectCount} project${projectCount === 1 ? "" : "s"}`
        : "Recent agent files";
  }
  if (elements.filesWorkspaceRefreshButton) {
    elements.filesWorkspaceRefreshButton.disabled = catalogBlocking || loadingCount > 0;
    elements.filesWorkspaceRefreshButton.title = catalogBlocking
      ? "Loading projects"
      : catalogRefreshing
        ? "Refreshing projects"
        : loadingCount > 0
          ? "Refreshing files"
          : "Refresh files";
    const label = elements.filesWorkspaceRefreshButton.querySelector(".button-text");
    if (label) {
      label.textContent = loadingCount > 0 ? "Refreshing..." : "Refresh";
    }
  }

  if (catalogBlocking) {
    setText(elements.filesWorkspaceState, "Loading projects", { empty: false });
  } else if (loadingCount > 0 && items.length === 0) {
    setText(elements.filesWorkspaceState, "Checking for files", { empty: false });
  } else if (items.length > 0) {
    setText(elements.filesWorkspaceState, `${items.length} recent file${items.length === 1 ? "" : "s"}`, { empty: false });
  } else {
    setText(elements.filesWorkspaceState, "No agent files yet", { empty: false });
  }

  const renderKey = JSON.stringify({
    loadingCount,
    downloadPendingId: state.artifactDownloadPendingId,
    items: items.map((artifact) => [
      artifact.id,
      artifact.projectPath,
      artifact.relativePath,
      artifact.modifiedAt,
      artifact.size,
      copyFeedbackActive(`artifact-download:${artifact.id}`),
    ]),
  });
  if (elements.filesWorkspaceList.dataset.renderKey === renderKey) {
    return;
  }

  clearNode(elements.filesWorkspaceList);
  if (catalogBlocking || (loadingCount > 0 && items.length === 0)) {
    const card = document.createElement("div");
    card.className = "history-state-card";
    card.textContent = "Looking for files...";
    elements.filesWorkspaceList.append(card);
  } else if (items.length === 0) {
    const card = document.createElement("div");
    card.className = "history-state-card";
    card.textContent = "Requested files saved into .clawdad/artifacts will show up here.";
    elements.filesWorkspaceList.append(card);
  } else {
    for (const artifact of items.slice(0, 80)) {
      elements.filesWorkspaceList.append(buildArtifactCard(artifact, {
        projectLabel: projectLabelForPath(artifact.projectPath),
      }));
    }
  }
  elements.filesWorkspaceList.dataset.renderKey = renderKey;
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
    card.textContent = "Requested files saved into .clawdad/artifacts will show up here.";
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

function buildCodexCheckCard(check) {
  const status = String(check?.status || "warn").toLowerCase();
  const card = document.createElement("article");
  card.className = `codex-check-card is-${status}`;

  const head = document.createElement("div");
  head.className = "codex-check-head";

  const title = document.createElement("div");
  title.className = "codex-check-title";
  title.textContent = String(check?.label || "Check");

  const badge = document.createElement("div");
  badge.className = "codex-check-status";
  badge.textContent = status;

  const detail = document.createElement("div");
  detail.className = "codex-check-detail";
  detail.textContent = String(check?.detail || "");

  head.append(title, badge);
  card.append(head, detail);
  return card;
}

function renderCodexIntegrationModal() {
  const project = currentCodexIntegrationProject();
  if (!project) {
    setText(elements.codexIntegrationState, "", { empty: true });
    clearNode(elements.codexIntegrationList);
    elements.codexIntegrationModal.hidden = true;
    return;
  }

  const integrationState = codexIntegrationStateFor(project.path);
  const report = integrationState.report || {};
  const checks = Array.isArray(report.checks) ? report.checks : [];
  const failCount = Number(report.failCount || 0);
  const warnCount = Number(report.warnCount || 0);
  const ready = report.ok === true;

  elements.codexIntegrationProject.textContent = project.displayName || project.slug || fallbackProjectLabel(project.path);
  elements.codexIntegrationStatus.textContent = ready
    ? warnCount > 0
      ? `${warnCount} warning${warnCount === 1 ? "" : "s"}`
      : "Codex integration ready"
    : integrationState.initialized
      ? `${failCount} issue${failCount === 1 ? "" : "s"}`
      : "Codex integration";

  const installLabel = elements.codexIntegrationInstallButton.querySelector(".button-text");
  if (installLabel) {
    installLabel.textContent = integrationState.installing ? "Installing…" : ready ? "Update" : "Install";
  }
  elements.codexIntegrationInstallButton.disabled = integrationState.installing || integrationState.loading;
  elements.codexIntegrationRefreshButton.disabled = integrationState.installing || integrationState.loading;

  if (integrationState.installing) {
    setText(elements.codexIntegrationState, "Installing Codex pack", { empty: false });
  } else if (integrationState.loading && !integrationState.initialized) {
    setText(elements.codexIntegrationState, "Checking Codex pack", { empty: false });
  } else if (integrationState.error) {
    setText(elements.codexIntegrationState, integrationState.error, { empty: false });
  } else if (ready && warnCount === 0) {
    setText(elements.codexIntegrationState, "Hooks, skills, plugin, and AGENTS guidance are installed", { empty: false });
  } else if (ready) {
    setText(elements.codexIntegrationState, "Installed with warnings", { empty: false });
  } else if (integrationState.initialized) {
    setText(elements.codexIntegrationState, "Install or update the Codex pack", { empty: false });
  } else {
    setText(elements.codexIntegrationState, "", { empty: true });
  }

  clearNode(elements.codexIntegrationList);
  if (checks.length === 0) {
    const card = document.createElement("div");
    card.className = "history-state-card";
    card.textContent = integrationState.loading ? "Checking…" : "No Codex integration checks loaded yet.";
    elements.codexIntegrationList.append(card);
  } else {
    for (const entry of checks) {
      elements.codexIntegrationList.append(buildCodexCheckCard(entry));
    }
  }

  elements.codexIntegrationModal.hidden = false;
}

function renderDelegateModal() {
  const project = currentDelegateProject();
  if (!project) {
    setText(elements.delegateState, "", { empty: true });
    if (elements.delegateOverview) {
      clearNode(elements.delegateOverview);
    }
    if (elements.delegateProgressList) {
      clearNode(elements.delegateProgressList);
      delete elements.delegateProgressList.dataset.renderKey;
    }
    if (elements.delegateDiagnosticsChecks) {
      clearNode(elements.delegateDiagnosticsChecks);
      delete elements.delegateDiagnosticsChecks.dataset.renderKey;
    }
    if (elements.delegateDebugList) {
      clearNode(elements.delegateDebugList);
      delete elements.delegateDebugList.dataset.renderKey;
    }
    clearNode(elements.delegateRunCardList);
    clearNode(elements.delegateRunList);
    if (elements.delegateSupervisorList) {
      clearNode(elements.delegateSupervisorList);
      delete elements.delegateSupervisorList.dataset.renderKey;
    }
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

  const laneId = currentDelegateLaneId();
  const delegateState = delegateStateFor(project.path, laneId);
  const status = delegateState.status;
  const latestPlan = delegateState.latestPlanSnapshot;
  const delegateSession = delegateState.delegateSession;
  const runLog = delegateState.runLog || {};
  const feed = delegateState.feed || {};
  const runSummarySnapshots = Array.isArray(delegateState.runSummarySnapshots)
    ? delegateState.runSummarySnapshots
    : [];
  const runCards = delegateRunCardData(delegateState, runLog);
  const runId = selectedDelegateRunId(project.path, delegateState, laneId);
  const delegateLogMode = delegateLogModeFor(project.path, laneId);
  const laneLabel = delegateLaneDisplayText({
    path: project.path,
    laneId,
    delegateLane: delegateState.lane || { laneId, displayName: delegateState.config?.displayName || "" },
  });
  const supervisorActive = delegateSupervisorIsActive(delegateState);

  elements.delegateProject.textContent =
    project.displayName || project.slug || fallbackProjectLabel(project.path);
  elements.delegateSession.textContent =
    [laneLabel, delegateSession?.label || ""].filter(Boolean).join(" • ") || "Delegate session will be created on first use";

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
    if (state.delegateRunPending || state.delegateSupervisorPending) {
      runButtonLabel.textContent = "Working…";
    } else if (supervisorActive) {
      runButtonLabel.textContent = "Stop Loop";
    } else if (status?.pauseRequested) {
      runButtonLabel.textContent = "Keep Going";
    } else if (status?.state === "running") {
      runButtonLabel.textContent = "Pause";
    } else {
      runButtonLabel.textContent = "Auto-Claw";
    }
  }
  const runButtonIcon = elements.delegateRunButton.querySelector(".auto-icon");
  if (runButtonIcon) {
    runButtonIcon.textContent =
      state.delegateRunPending || state.delegateSupervisorPending || supervisorActive || status?.state === "running"
        ? ""
        : delegateAutoIcon;
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
    state.delegatePlanPending || state.delegateRunPending || state.delegateSupervisorPending || !project.path;
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
  renderDelegateProgress(project, delegateState, runLog);
  renderDelegateStartChecks(project, delegateState, laneId, runLog);
  renderDelegateDebugList(project, delegateState, laneId, runLog);

  clearNode(elements.delegateRunCardList);
  if (!delegateState.initialized && delegateState.loading) {
    const card = document.createElement("div");
    card.className = "history-state-card";
    card.textContent = "Loading delegation history...";
    elements.delegateRunCardList.append(card);
  } else if (runCards.length === 0) {
    const card = document.createElement("div");
    card.className = "history-state-card";
    card.textContent = "No delegation history yet.";
    elements.delegateRunCardList.append(card);
  } else {
    for (const run of runCards) {
      elements.delegateRunCardList.append(buildDelegateRunCard(run, { selected: run.runId === runId }));
    }
  }

  renderDelegateCarouselChrome();
  renderDelegateSupervisorTimeline(delegateState);

  const runKey = delegateRunKey(project.path, runId, laneId);
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
      card.textContent = "Choose a delegation run to see its log.";
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
      laneId,
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

function catalogIsRefreshing() {
  return state.projectsLoading && state.projects.length > 0;
}

function catalogBlocksInteraction() {
  return catalogIsBootstrapping();
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

  const entries = currentThreadEntries().filter((entry) =>
    threadEntryVisibleInQueue(entry, state.threadEntries),
  );
  if (entries.length === 0) {
    setText(elements.mailboxState, "", { empty: true });
    return;
  }

  const latest = entries[entries.length - 1];
  if (threadEntryStatus(latest) === "answered") {
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

function normalizeDispatchMode(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["queue", "queued", "next"].includes(normalized)) {
    return "queue";
  }
  return "direct";
}

function normalizeAccessMode(value) {
  return accessModes.includes(value) ? value : "repo";
}

function permissionModeForAccessMode(value = state.accessMode) {
  return normalizeAccessMode(value) === "full" ? "full" : "approve";
}

function restoreComposerAccessMode() {
  try {
    state.accessMode = normalizeAccessMode(localStorage.getItem(composerAccessModeKey));
  } catch {
    state.accessMode = "repo";
  }
}

function persistComposerAccessMode() {
  try {
    localStorage.setItem(composerAccessModeKey, normalizeAccessMode(state.accessMode));
  } catch {
    // Ignore storage failures; the current in-memory selection still applies.
  }
}

function setAccessMode(mode, { persist = true } = {}) {
  state.accessMode = normalizeAccessMode(mode);
  if (persist) {
    persistComposerAccessMode();
  }
  updateAccessModeControl();
}

function updateAccessModeControl() {
  if (!elements.composerAccessSelect) {
    return;
  }
  const mode = normalizeAccessMode(state.accessMode);
  state.accessMode = mode;
  if (elements.composerAccessSelect.value !== mode) {
    elements.composerAccessSelect.value = mode;
  }
  elements.composerAccessSelect.title = mode === "full" ? "Full access" : "Repo scoped";
}

function dispatchModeAllowsBusySend(mode = state.dispatchMode) {
  return dispatchModes.includes(normalizeDispatchMode(mode));
}

function setDispatchMode(mode, { closeTools = false } = {}) {
  state.dispatchMode = normalizeDispatchMode(mode);
  if (closeTools) {
    closeComposerToolsMenu({ focusComposer: false });
    return;
  }
  updateDispatchModeButton();
  updateSendAvailability();
}

function cycleDispatchMode() {
  const currentIndex = dispatchModes.indexOf(normalizeDispatchMode(state.dispatchMode));
  setDispatchMode(dispatchModes[(currentIndex + 1) % dispatchModes.length]);
}

function renderComposerToolsMenu() {
  if (elements.composerToolsButton) {
    elements.composerToolsButton.setAttribute("aria-expanded", String(state.composerToolsOpen));
    elements.composerToolsButton.classList.toggle("is-active", state.composerToolsOpen);
  }
  if (elements.composerToolsMenu) {
    elements.composerToolsMenu.hidden = !state.composerToolsOpen;
  }
}

function updateDispatchModeButton() {
  const mode = normalizeDispatchMode(state.dispatchMode);
  state.dispatchMode = mode;
  const details = dispatchModeDetails[mode] || dispatchModeDetails.direct;
  if (elements.composerToolsButton) {
    elements.composerToolsButton.classList.toggle("is-queue", mode === "queue");
    elements.composerToolsButton.classList.toggle("is-direct", mode === "direct");
    elements.composerToolsButton.setAttribute("aria-label", `Open composer tools. ${details.aria}`);
    elements.composerToolsButton.title = details.title;
  }
  for (const button of elements.dispatchModeButtons) {
    const active = normalizeDispatchMode(button.dataset.dispatchMode) === mode;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  }
  updateAccessModeControl();
}

function dispatchButtonText({ catalogBlocking = false, sessionBusy = false, allowBusySend = true } = {}) {
  const mode = normalizeDispatchMode(state.dispatchMode);
  const details = dispatchModeDetails[mode] || dispatchModeDetails.direct;
  const modeLabel = details.label;
  if (state.dispatchPending) {
    return "Sending…";
  }
  if (catalogBlocking) {
    return "Loading…";
  }
  if (sessionBusy && !allowBusySend) {
    return `Working (${modeLabel})`;
  }
  return `Send (${modeLabel})`;
}

function updateSendAvailability() {
  const session = currentSession();
  const hasPending = Boolean(pendingEntryForSession(state.selectedProject, state.selectedSessionId));
  const sessionBusy = hasPending || sessionIsBusy(session);
  const allowBusySend = dispatchModeAllowsBusySend();
  const catalogBlocking = catalogBlocksInteraction();
  const hasDraft = Boolean(String(elements.messageInput?.value || "").trim()) || state.composerAttachments.length > 0;
  const canSend =
    !catalogBlocking &&
    !state.dispatchPending &&
    !state.sessionSwitchPending &&
    !state.sessionCreatePending &&
    Boolean(state.selectedProject) &&
    Boolean(state.selectedSessionId) &&
    hasDraft &&
    (!sessionBusy || allowBusySend);

  elements.dispatchButton.disabled = !canSend;
  elements.dispatchButton.querySelector(".button-text").textContent = dispatchButtonText({
    catalogBlocking,
    sessionBusy,
    allowBusySend,
  });
  updateMessageCopyButton();
  updateMessageCutButton();
}

function updateThreadButtonAvailability() {
  const session = currentSession();
  if (elements.sessionAddButton) {
    elements.sessionAddButton.disabled =
      catalogBlocksInteraction() ||
      state.sessionCreatePending ||
      state.dispatchPending ||
      !state.selectedProject;
    elements.sessionAddButton.setAttribute(
      "aria-label",
      state.sessionCreatePending ? "Starting new Codex session" : "Start new Codex session",
    );
    elements.sessionAddButton.title =
      state.sessionCreatePending ? "Starting new Codex session…" : "Start new Codex session";
  }
  elements.sessionThreadButton.disabled =
    catalogBlocksInteraction() ||
    state.sessionCreatePending ||
    !state.selectedProject ||
    !state.selectedSessionId ||
    Boolean(session?.pendingCreation);
}

function updateComposerTerminalButtonAvailability() {
  if (!elements.currentTerminalButton) {
    return;
  }

  const entry = currentSessionTerminalEntry();
  const launchKey = terminalSessionKey(entry.projectPath, entry.sessionId);
  const session = currentSession();
  const disabled =
    catalogBlocksInteraction() ||
    state.sessionCreatePending ||
    Boolean(session?.pendingCreation) ||
    !canOpenSessionInTerminal(entry);
  const pending = Boolean(launchKey) && state.terminalLaunchPendingKey === launchKey;

  elements.currentTerminalButton.dataset.terminalLaunchKey = launchKey;
  decorateOpenTerminalButton(elements.currentTerminalButton, launchKey);
  elements.currentTerminalButton.disabled = disabled || pending;
  if (pending) {
    return;
  }

  const label = disabled
    ? "Select a session before opening terminal"
    : "Open selected session in terminal";
  elements.currentTerminalButton.setAttribute("aria-label", label);
  elements.currentTerminalButton.title = label;
}

function updateSummaryButtonAvailability() {
  const disabled = catalogBlocksInteraction() || !state.selectedProject;
  if (elements.projectSummaryButton) {
    elements.projectSummaryButton.disabled = disabled;
  }
  if (elements.projectCodexButton) {
    elements.projectCodexButton.disabled = disabled;
  }
  if (elements.summaryWorkspaceTab) {
    elements.summaryWorkspaceTab.disabled = disabled;
    elements.summaryWorkspaceTab.setAttribute("aria-disabled", String(disabled));
    elements.summaryWorkspaceTab.title = disabled ? "Select a project first" : "Project summary";
  }
}

function updateDelegateButtonAvailability() {
  if (!elements.projectDelegateButton) {
    return;
  }

  const project = currentProject();
  const defaultLane = projectDelegateLaneItems(project).find((lane) => normalizeDelegateLaneId(lane.laneId) === "default");
  const statusState = String(defaultLane?.status?.state || "").trim().toLowerCase();
  const live = statusState === "running";
  const blocked = statusState === "blocked" || statusState === "failed";
  const disabled = catalogBlocksInteraction() || !project?.path;
  const label = elements.projectDelegateButton.querySelector(".button-text");

  elements.projectDelegateButton.disabled = disabled;
  elements.projectDelegateButton.classList.toggle("is-live", live);
  elements.projectDelegateButton.classList.toggle("is-blocked", blocked);
  elements.projectDelegateButton.title = disabled
    ? "Select a project first"
    : live
      ? "Open the live Auto-Claw loop"
      : "Open Auto-Claw for this project";
  elements.projectDelegateButton.setAttribute(
    "aria-label",
    disabled
      ? "Select a project before opening Auto-Claw"
      : live
        ? "Open live Auto-Claw loop for selected project"
        : "Open Auto-Claw for selected project",
  );
  if (label) {
    label.textContent = live ? "Live" : "Auto-Claw";
  }
}

function updateActiveRunsButtonAvailability() {
  const activeCount = activeDelegateProjects().length;
  if (elements.activeRunsOrb) {
    elements.activeRunsOrb.hidden = activeCount === 0;
  }
  if (elements.activeRunsButton) {
    elements.activeRunsButton.disabled = catalogBlocksInteraction() || activeCount === 0;
    elements.activeRunsButton.setAttribute(
      "aria-label",
      activeCount > 0
        ? `Open delegation dashboard, ${activeCount} live lane${activeCount === 1 ? "" : "s"}`
        : "No live delegation lanes",
    );
    elements.activeRunsButton.title = activeCount > 0 ? "Delegation dashboard" : "No live delegation lanes";
  }
}

function updateArtifactsButtonAvailability() {
  const projectDisabled = catalogBlocksInteraction() || !state.selectedProject;
  if (elements.projectArtifactsButton) {
    elements.projectArtifactsButton.disabled = projectDisabled;
  }
  if (projectDisabled && elements.projectArtifactsOrb) {
    elements.projectArtifactsOrb.hidden = true;
  }
}

function updateImportButtonAvailability() {
  if (!elements.sessionImportButton) {
    return;
  }

  const projectPath = state.selectedProject;
  const project = currentProject();
  const importState = importableSessionsStateFor(projectPath);
  const canShow =
    Boolean(projectPath) &&
    String(project?.provider || "codex").trim().toLowerCase() === "codex" &&
    !Boolean(currentSession()?.pendingCreation);
  elements.sessionImportButton.hidden = !canShow;
  elements.sessionImportButton.setAttribute("aria-hidden", canShow ? "false" : "true");
  elements.sessionImportButton.tabIndex = canShow ? 0 : -1;
  elements.sessionImportButton.disabled =
    !canShow ||
    catalogBlocksInteraction() ||
    state.sessionSwitchPending ||
    state.sessionCreatePending ||
    Boolean(importState.loading);
  if (elements.sessionImportOrb) {
    elements.sessionImportOrb.hidden =
      !canShow ||
      !(Array.isArray(importState.items) && importState.items.length > 0);
  }
}

function updateSessionRenameAvailability() {
  const session = currentSession();
  elements.sessionRenameButton.disabled =
    catalogBlocksInteraction() ||
    state.sessionSwitchPending ||
    state.sessionCreatePending ||
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

function shortTerminalRequestId(requestId) {
  const value = String(requestId || "").trim();
  return value.length > 18 ? `${value.slice(0, 8)}...${value.slice(-6)}` : value;
}

function formatTerminalEventTime(value) {
  const timestamp = Date.parse(String(value || ""));
  if (!Number.isFinite(timestamp)) {
    return "";
  }
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function buildTerminalStreamRow(event) {
  const normalized = normalizeTerminalStreamEvent(event);
  const row = document.createElement("div");
  const level = ["info", "success", "warn", "error"].includes(normalized.level)
    ? normalized.level
    : "info";
  row.className = `terminal-stream-row is-${level}`;

  const marker = document.createElement("div");
  marker.className = "terminal-stream-marker";
  marker.setAttribute("aria-hidden", "true");

  const body = document.createElement("div");
  body.className = "terminal-stream-row-body";

  const head = document.createElement("div");
  head.className = "terminal-stream-row-head";

  const label = document.createElement("div");
  label.className = "terminal-stream-row-label";
  label.textContent = normalized.label;
  head.append(label);

  const time = formatTerminalEventTime(normalized.at);
  if (time) {
    const timeNode = document.createElement("div");
    timeNode.className = "terminal-stream-row-time";
    timeNode.textContent = time;
    head.append(timeNode);
  }

  body.append(head);
  if (normalized.text) {
    const text = document.createElement("pre");
    text.className = "terminal-stream-row-text";
    text.textContent = normalized.text;
    body.append(text);
  }

  row.append(marker, body);
  return row;
}

function renderTerminalPanel() {
  if (
    !elements.terminalPanel ||
    !elements.terminalStreamList ||
    !elements.terminalPanelTitle ||
    !elements.terminalPanelStatus ||
    !elements.terminalPanelMeta ||
    !elements.terminalStreamState
  ) {
    return;
  }

  const panel = state.terminalPanel;
  if (!terminalPanelIsOpen()) {
    elements.terminalPanel.hidden = true;
    clearNode(elements.terminalStreamList);
    setText(elements.terminalStreamState, "", { empty: true });
    return;
  }

  const statusLabel = terminalPanelStatusLabel(panel.requestStatus);
  const terminal = terminalPanelStatusIsTerminal(panel.requestStatus);
  const metaParts = [
    panel.sessionLabel || panel.sessionId,
    `Request ${shortTerminalRequestId(panel.requestId)}`,
  ].filter(Boolean);
  elements.terminalPanel.hidden = false;
  elements.terminalPanelTitle.textContent = panel.projectLabel || fallbackProjectLabel(panel.projectPath);
  elements.terminalPanelStatus.textContent = statusLabel;
  elements.terminalPanelStatus.classList.toggle("is-terminal", terminal);
  elements.terminalPanelStatus.classList.toggle(
    "is-failed",
    String(panel.requestStatus?.status || panel.requestStatus?.state || "").toLowerCase() === "failed",
  );
  elements.terminalPanelMeta.textContent = metaParts.join(" • ");

  const launchKey = terminalSessionKey(panel.projectPath, panel.sessionId);
  const externalPending = Boolean(launchKey) && state.terminalLaunchPendingKey === launchKey;
  if (elements.terminalPanelOpenExternal) {
    elements.terminalPanelOpenExternal.disabled =
      externalPending ||
      !canOpenSessionInTerminal({
        projectPath: panel.projectPath,
        sessionId: panel.sessionId,
      });
    elements.terminalPanelOpenExternal.classList.toggle("is-loading", externalPending);
    elements.terminalPanelOpenExternal.innerHTML =
      `${terminalIconMarkup()}<span class="button-text">${externalPending ? "Opening Terminal" : "Open In Terminal"}</span>`;
  }

  if (panel.error) {
    setText(elements.terminalStreamState, panel.error, { empty: false });
  } else if (panel.loading && !panel.initialized) {
    setText(elements.terminalStreamState, "Loading stream", { empty: false });
  } else if (panel.events.length === 0 && terminal) {
    setText(elements.terminalStreamState, "Completed without a saved terminal log", { empty: false });
  } else if (panel.events.length === 0) {
    setText(elements.terminalStreamState, "Waiting for terminal output", { empty: false });
  } else if (panel.loading) {
    setText(elements.terminalStreamState, "Updating stream", { empty: false });
  } else {
    setText(elements.terminalStreamState, "", { empty: true });
  }

  const renderKey = panel.events
    .map((event) => `${event.id}:${event.at}:${event.label}:${event.text.length}`)
    .join("|");
  if (elements.terminalStreamList.dataset.renderKey !== renderKey) {
    clearNode(elements.terminalStreamList);
    for (const event of panel.events) {
      elements.terminalStreamList.append(buildTerminalStreamRow(event));
    }
    elements.terminalStreamList.dataset.renderKey = renderKey;
    if (terminalPanelStickToBottom) {
      window.requestAnimationFrame(() => scrollTerminalStreamToBottom());
    }
  }
}

function renderAll() {
  pruneCopyFeedback();
  renderSystemSetupAssistant();
  renderWorkspaceTabs();
  renderWorkspaceSetup();
  renderSettingsModal();
  renderDirectoryBrowserModal();
  renderProjectOptions();
  renderProjectPickerModal();
  updateProjectControlAppearance();
  renderSessionOptions();
  renderThreadPreviewPanel();
  renderSelectedProjectDelegateCard();
  renderActiveRunsInline();
  renderQueueList();
  renderArtifactShelf();
  renderFilesWorkspace();
  renderModal();
  renderComposerAttachments();
  renderComposerToolsMenu();
  renderQuickPromptModal();
  renderSessionImportModal();
  renderSessionTitleModal();
  renderSummaryModal();
  renderCodexIntegrationModal();
  renderActiveRunsModal();
  renderArtifactsModal();
  renderDelegateModal();
  renderProjectModal();
  renderQueueArchiveConfirm();
  renderTerminalPanel();
  updateMailboxState();
  updateQueueUnreadOrb();
  updateDispatchModeButton();
  updateSendAvailability();
  updateThreadButtonAvailability();
  updateImportButtonAvailability();
  updateSessionRenameAvailability();
  updateSummaryButtonAvailability();
  updateArtifactsButtonAvailability();
  updateDelegateButtonAvailability();
  updateActiveRunsButtonAvailability();
  updateQueueChrome();
  updateComposerVoiceButton();
  updateBodyModalState();
  refreshCopyButtons();
  updateComposerTerminalButtonAvailability();
  syncAudioLoadingSpinnerAnimation();
}

async function reconcileThreadEntries() {
  const pendingEntries = state.threadEntries.filter(
    (entry) => threadEntryIsPending(entry) && threadEntryVisibleInQueue(entry, state.threadEntries),
  );
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
    const liveRequestId = String(mailboxStatus.request_id || "").trim();
    const trackedRequestId = String(entry.requestId || "").trim();
    const matchingCompletedSessions = completedSessionsMatchingEntry(project, entry);
    const mailboxCompletionFallbackSession =
      session ||
      (matchingCompletedSessions.length === 1 ? matchingCompletedSessions[0] : null);

    if (trackedRequestId) {
      const exactReadKey = `${entry.projectPath}:${trackedRequestId}:exact`;
      if (!readsByRequest.has(exactReadKey)) {
        try {
          const payload = await fetchJson(
            `/v1/read?project=${encodeURIComponent(entry.projectPath)}&requestId=${encodeURIComponent(trackedRequestId)}&raw=1`,
          );
          readsByRequest.set(exactReadKey, payload);
        } catch (error) {
          readsByRequest.set(exactReadKey, { error });
        }
      }

      const exactPayload = readsByRequest.get(exactReadKey) || {};
      const exactHistoryItem = exactPayload.historyItem ? normalizeHistoryItem(exactPayload.historyItem) : null;
      const exactMailboxStatus = exactPayload.mailboxStatus || {};
      const exactMailboxRequestId = String(
        exactMailboxStatus.request_id || exactMailboxStatus.requestId || "",
      ).trim();
      const exactMailboxMatches = exactMailboxRequestId === trackedRequestId;
      const exactStatus =
        historyStatusFromLifecycle(exactHistoryItem?.status) ||
        (exactMailboxMatches ? historyStatusFromLifecycle(exactMailboxStatus.state) : "");

      if (terminalHistoryStatus(exactStatus)) {
        const sessionResult = sessionDetailsForHistoryResult(
          project,
          session,
          exactHistoryItem,
          exactMailboxStatus,
          entry,
        );
        completeThreadEntry(entry, {
          status: exactStatus,
          requestState: exactStatus,
          handoffPending: false,
          sessionId: sessionResult.sessionId || entry.sessionId,
          sessionLabel: sessionOptionLabel(sessionResult.session, entry.projectPath),
          answeredAt:
            exactHistoryItem?.answeredAt ||
            exactMailboxStatus.completed_at ||
            exactMailboxStatus.completedAt ||
            sessionResult.session?.lastResponse ||
            project?.lastResponse ||
            new Date().toISOString(),
          requestId: trackedRequestId,
          response:
            String(exactHistoryItem?.response || "").trim() ||
            String(exactPayload.output || "").trim() ||
            (exactStatus === "failed" ? "Failed." : ""),
          exitCode:
            typeof exactHistoryItem?.exitCode === "number"
              ? exactHistoryItem.exitCode
              : exactStatus === "failed"
                ? 1
                : 0,
          ...(exactHistoryItem?.audio ? { audio: exactHistoryItem.audio } : {}),
          seenAt: null,
        });
        continue;
      }
      if (exactStatus === "working") {
        updateThreadEntry(entry.id, {
          status: "working",
          requestState: "working",
          handoffPending: false,
          sessionId: exactHistoryItem?.sessionId || entry.sessionId,
        });
        continue;
      }
    }

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
          requestState: status,
          handoffPending: false,
          sessionId: mailboxCompletionFallbackSession.sessionId || entry.sessionId,
          sessionLabel: sessionOptionLabel(
            mailboxCompletionFallbackSession,
            entry.projectPath,
          ),
          answeredAt:
            mailboxStatus.completed_at ||
            mailboxStatus.completedAt ||
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

    const sentAtMs = new Date(entry.sentAt || 0).getTime();
    const mailboxDispatchMs = new Date(mailboxStatus.dispatched_at || 0).getTime();
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
        requestState: status === "running" || status === "dispatched" ? "running" : status,
        handoffPending: false,
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
      updateThreadEntry(entry.id, {
        status: "working",
        requestState: "working",
        handoffPending: false,
      });
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
      requestState: status,
      handoffPending: false,
      answeredAt:
        mailboxStatus.completed_at ||
        mailboxStatus.completedAt ||
        session?.lastResponse ||
        project?.lastResponse ||
        new Date().toISOString(),
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
      historyState.items.some((entry) => threadEntryIsPending(entry));
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
      const fullCatalog = state.activeRunsModalOpen || state.workspaceMode === "auto";
      const payload = await fetchJson(fullCatalog ? "/v1/projects" : "/v1/projects?lean=1");
      applyWorkspacePayload(payload.workspace);
      state.projects = Array.isArray(payload.projects)
        ? payload.projects.map(hydrateProjectVisuals).sort(compareProjects)
        : [];
      state.recentThreads = Array.isArray(payload.recentThreads)
        ? mergeRecentThreadSummaries(payload.recentThreads)
        : recentThreadsFromProjects(state.projects);
      state.threadPreviewError = "";
      syncSelectedProject(payload.defaultProject || state.selectedProject);
      syncSelectedSession(state.selectedSessionId);
      cacheProjects(payload);
      renderAll();
      if (payload.autoImportScheduled && !state.projectAutoImportRefreshTimer) {
        state.projectAutoImportRefreshTimer = window.setTimeout(() => {
          state.projectAutoImportRefreshTimer = null;
          void refreshProjects().catch(() => {});
        }, 2500);
      }
      await reconcileThreadEntries();
      hydrateReturnedThreadEntries();
      if (state.selectedProject) {
        if (state.sessionImportModalProject === state.selectedProject) {
          void refreshImportableSessions(state.selectedProject).catch(() => {});
        }
      }
      if (state.activeRunsModalOpen) {
        void primeActiveRunsModal().catch(() => {});
      }
      if (state.workspaceMode === "auto") {
        void primeActiveRunsModal().then(renderAll).catch(() => {});
      }
    } catch (error) {
      state.threadPreviewError = error.message || "Threads could not refresh.";
      throw error;
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

async function loadQuickPrompts({ force = false } = {}) {
  if (state.quickPromptsLoading && !force) {
    return;
  }
  if (state.quickPromptsLoaded && !force) {
    return;
  }

  state.quickPromptsLoading = true;
  state.quickPromptError = "";
  renderAll();
  try {
    const payload = await fetchJson("/v1/quick-prompts");
    state.quickPrompts = normalizeQuickPrompts(payload.prompts);
    state.quickPromptsLoaded = true;
    state.quickPromptResetConfirm = false;
  } catch (error) {
    state.quickPromptError = error.message;
    showError(error);
  } finally {
    state.quickPromptsLoading = false;
    renderAll();
  }
}

async function saveQuickPrompts(prompts, { reset = false } = {}) {
  state.quickPromptsSaving = true;
  state.quickPromptError = "";
  renderAll();
  try {
    const payload = await fetchJson("/v1/quick-prompts", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(reset ? { reset: true } : { prompts }),
    });
    state.quickPrompts = normalizeQuickPrompts(payload.prompts);
    state.quickPromptsLoaded = true;
    state.quickPromptDraftMode = "";
    state.quickPromptDraftId = "";
    state.quickPromptDraftTitle = "";
    state.quickPromptDraftText = "";
    state.quickPromptResetConfirm = false;
  } catch (error) {
    state.quickPromptError = error.message;
    showError(error);
  } finally {
    state.quickPromptsSaving = false;
    renderAll();
  }
}

async function refreshRecentHistory({ force = false, project = "" } = {}) {
  if (state.recentHistoryRefreshPromise) {
    return state.recentHistoryRefreshPromise;
  }

  const now = Date.now();
  if (!force && state.recentHistoryLoadedAt > 0 && now - state.recentHistoryLoadedAt < recentHistoryRefreshMs) {
    return;
  }

  const params = new URLSearchParams({
    limit: String(recentHistoryLimit),
    sessionLimit: String(recentHistorySessionLimit),
    perSessionLimit: String(recentHistoryPerSessionLimit),
  });
  const normalizedProject = String(project || "").trim();
  if (normalizedProject) {
    params.set("project", normalizedProject);
  }

  state.recentHistoryRefreshPromise = (async () => {
    const payload = await fetchJson(`/v1/history/recent?${params.toString()}`);
    state.recentHistoryLoadedAt = Date.now();
    const changed = hydrateThreadEntriesFromHistoryItems(payload.items || []);
    if (changed) {
      renderAll();
    }
  })()
    .catch((error) => {
      console.warn("[clawdad] recent history refresh failed", error);
    })
    .finally(() => {
      state.recentHistoryRefreshPromise = null;
    });

  return state.recentHistoryRefreshPromise;
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
  const targets = new Map();
  if (state.delegateModalProject) {
    targets.set(
      delegateStateKey(state.delegateModalProject, currentDelegateLaneId()),
      { projectPath: state.delegateModalProject, laneId: currentDelegateLaneId() },
    );
  }

  for (const [key, delegateState] of Object.entries(state.delegatesByProject)) {
    const delegateStatus = delegateState?.status?.state;
    if (
      delegateStatus === "planning" ||
      delegateStatus === "running" ||
      delegateSupervisorIsActive(delegateState)
    ) {
      const projectPath = delegateStateProjectPathFromKey(key, delegateState);
      const laneId = delegateStateLaneIdFromKey(key, delegateState);
      targets.set(delegateStateKey(projectPath, laneId), { projectPath, laneId });
    }
  }

  return [...targets.values()].filter((entry) => entry.projectPath);
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
    targets.map((entry) => loadDelegateProject(entry.projectPath, { force: true, laneId: entry.laneId })),
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

  return [...targets].filter(Boolean);
}

async function refreshArtifacts({ force = false } = {}) {
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

  if (sessionId === newSessionSelectValue) {
    await handleSessionCreate();
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

async function handleSessionCreate() {
  const project = currentProject();
  if (!project?.path || state.sessionCreatePending) {
    return;
  }

  state.sessionCreatePending = true;
  renderAll();

  try {
    const payload = await fetchJson("/v1/sessions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        project: project.path,
        provider: project.provider || "codex",
      }),
    });

    if (payload.projectDetails) {
      const selectedProjectDetails = projectWithActiveSession(payload.projectDetails, payload.sessionId);
      upsertProject(selectedProjectDetails);
      state.selectedProject = selectedProjectDetails.path;
      if (payload.sessionId) {
        state.selectedSessionId = payload.sessionId;
      }
      syncSelectedSession(payload.sessionId, { preferCurrent: false });
    } else {
      await refreshProjects();
      syncSelectedSession(payload.sessionId || "", { preferCurrent: false });
    }
  } catch (error) {
    await refreshProjects().catch(() => {});
    syncSelectedSession("", { preferCurrent: true });
    showError(error);
  } finally {
    state.sessionCreatePending = false;
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
      ? mergeHistoryItems(localItems, pageItems)
      : appendOlder
        ? mergeHistoryItems(pageItems, existing.items)
        : mergeHistoryItems(localItems, pageItems);
    nextItems.forEach((item) => hydrateAudioAvailabilityFromHistoryItem(item));

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
  if (systemSetupIsOpen()) {
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
        stickToBottom: false,
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

  if (document.activeElement instanceof HTMLElement) {
    sessionThreadReturnFocus = document.activeElement;
  }

  state.sessionImportModalProject = "";
  state.projectPickerOpen = false;
  state.projectModalOpen = false;
  state.summaryModalProject = "";
  state.codexIntegrationModalProject = "";
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
      updateDetailScrollBottomButton();
    });
  }
}

function closeSessionThread({ restoreFocus = true } = {}) {
  const focusTarget = sessionThreadReturnFocus || elements.sessionThreadButton;
  state.modalThread = null;
  renderAll();
  if (restoreFocus) {
    window.requestAnimationFrame(() => focusTarget?.focus());
  }
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
  state.activeRunsModalOpen = false;
  state.artifactModalProject = "";
  state.delegateModalProject = "";
  state.codexIntegrationModalProject = "";
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

async function loadCodexIntegration(projectPath, { force = false } = {}) {
  if (!projectPath) {
    return codexIntegrationStateFor(projectPath);
  }
  const existing = codexIntegrationStateFor(projectPath);
  if (existing.loading || existing.installing) {
    return existing;
  }
  if (!force && existing.initialized) {
    return existing;
  }

  setCodexIntegrationState(projectPath, {
    loading: true,
    error: "",
  });
  renderAll();

  try {
    const payload = await fetchJson(
      `/v1/codex-integration?project=${encodeURIComponent(projectPath)}`,
    );
    setCodexIntegrationState(projectPath, {
      report: payload,
      operations: [],
      loading: false,
      initialized: true,
      error: "",
    });
  } catch (error) {
    setCodexIntegrationState(projectPath, {
      loading: false,
      initialized: true,
      error: error.message,
      report: error.payload && Array.isArray(error.payload.checks) ? error.payload : existing.report,
    });
  }

  renderAll();
  return codexIntegrationStateFor(projectPath);
}

async function openCodexIntegration(projectPath = state.selectedProject) {
  if (!projectPath) {
    return;
  }

  state.modalThread = null;
  state.projectModalOpen = false;
  state.sessionImportModalProject = "";
  state.activeRunsModalOpen = false;
  state.artifactModalProject = "";
  state.delegateModalProject = "";
  state.sessionTitleModalProject = "";
  state.sessionTitleModalSessionId = "";
  state.summaryModalProject = "";
  state.codexIntegrationModalProject = projectPath;
  renderAll();
  await loadCodexIntegration(projectPath);
}

function closeCodexIntegration() {
  state.codexIntegrationModalProject = "";
  renderAll();
}

async function installCodexIntegrationForCurrentProject() {
  const project = currentCodexIntegrationProject();
  if (!project?.path) {
    return;
  }
  const projectPath = project.path;
  setCodexIntegrationState(projectPath, {
    installing: true,
    error: "",
  });
  renderAll();

  try {
    const payload = await fetchJson("/v1/codex-integration/install", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        project: projectPath,
      }),
    });
    setCodexIntegrationState(projectPath, {
      report: payload.report || payload,
      operations: Array.isArray(payload.operations) ? payload.operations : [],
      installing: false,
      initialized: true,
      error: "",
    });
  } catch (error) {
    setCodexIntegrationState(projectPath, {
      installing: false,
      initialized: true,
      error: error.message,
      report: error.payload?.report || error.payload || codexIntegrationStateFor(projectPath).report,
    });
  }

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
  if (
    !force &&
    existing.initialized &&
    Date.now() - Number(existing.loadedAt || 0) < artifactRefreshFreshMs
  ) {
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
      loadedAt: Date.now(),
      error: "",
      artifactRoot: String(payload.artifactRoot || ""),
      items: Array.isArray(payload.artifacts) ? payload.artifacts.map(normalizeArtifact) : [],
      dumpy: normalizeDumpyHandoff(payload.dumpy),
    });
    return artifactsStateFor(projectPath);
  })()
    .catch((error) => {
      setArtifactsState(projectPath, {
        loading: false,
        initialized: true,
        loadedAt: Date.now(),
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
  state.codexIntegrationModalProject = "";
  state.activeRunsModalOpen = false;
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
  state.codexIntegrationModalProject = "";
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
  state.codexIntegrationModalProject = "";
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

async function loadDelegateRunLog(
  projectPath,
  { force = false, reset = false, runId: requestedRunId = "", laneId = "default" } = {},
) {
  const normalizedLaneId = normalizeDelegateLaneId(laneId);
  if (!projectPath) {
    return delegateStateFor(projectPath, normalizedLaneId).runLog;
  }

  const existing = delegateStateFor(projectPath, normalizedLaneId);
  const statusRunId = existing.status?.runId || "";
  const existingRunId = existing.runLog?.runId || "";
  const selectedKey = delegateStateKey(projectPath, normalizedLaneId);
  const selectedRunIdValue = state.delegateSelectedRunIds[selectedKey] || "";
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
    }, normalizedLaneId);
    return delegateStateFor(projectPath, normalizedLaneId).runLog;
  }

  if (existing.runLog?.loading) {
    return existing.runLog;
  }
  state.delegateSelectedRunIds[selectedKey] = runId;
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
  }, normalizedLaneId);
  if (showLoadingState) {
    renderAll();
  }

  try {
    const cursor = shouldReset || !existing.runLog?.initialized
      ? "tail"
      : String(existing.runLog?.nextCursor || "0");
    const payload = await fetchJson(
      `/v1/delegate/run-log?project=${encodeURIComponent(projectPath)}&lane=${encodeURIComponent(normalizedLaneId)}&runId=${encodeURIComponent(runId)}&cursor=${encodeURIComponent(cursor)}`,
    );
    const incomingEvents = Array.isArray(payload.events)
      ? payload.events.map(normalizeDelegateRunEvent)
      : [];
    const keptEvents = shouldReset ? [] : existing.runLog?.events || [];
    setDelegateState(projectPath, {
      runList: Array.isArray(payload.delegateRuns)
        ? payload.delegateRuns.map(normalizeDelegateRunInfo)
        : delegateStateFor(projectPath, normalizedLaneId).runList,
      latestRunSummarySnapshot: payload.latestRunSummarySnapshot
        ? normalizeDelegateRunSummarySnapshot(payload.latestRunSummarySnapshot)
        : delegateStateFor(projectPath, normalizedLaneId).latestRunSummarySnapshot,
      runSummarySnapshots: Array.isArray(payload.runSummarySnapshots)
        ? payload.runSummarySnapshots.map(normalizeDelegateRunSummarySnapshot)
        : delegateStateFor(projectPath, normalizedLaneId).runSummarySnapshots,
      runLog: {
        runId: String(payload.runId || runId),
        events: mergeDelegateRunEvents(keptEvents, incomingEvents),
        nextCursor: String(payload.nextCursor || "0"),
        total: Number.parseInt(String(payload.total || "0"), 10) || 0,
        loading: false,
        initialized: true,
        error: "",
      },
    }, normalizedLaneId);
  } catch (error) {
    setDelegateState(projectPath, {
      runLog: {
        ...(delegateStateFor(projectPath, normalizedLaneId).runLog || {}),
        runId,
        loading: false,
        initialized: true,
        error: error.message,
      },
    }, normalizedLaneId);
  }

  renderAll();
  return delegateStateFor(projectPath, normalizedLaneId).runLog;
}

async function loadDelegateFeed(projectPath, { force = false, laneId = "default" } = {}) {
  const normalizedLaneId = normalizeDelegateLaneId(laneId);
  if (!projectPath) {
    return delegateStateFor(projectPath, normalizedLaneId).feed;
  }

  const existing = delegateStateFor(projectPath, normalizedLaneId);
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
  }, normalizedLaneId);
  renderAll();

  try {
    const payload = await fetchJson(
      `/v1/delegate/feed?project=${encodeURIComponent(projectPath)}&lane=${encodeURIComponent(normalizedLaneId)}&mode=review`,
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
    }, normalizedLaneId);
  } catch (error) {
    setDelegateState(projectPath, {
      feed: {
        ...(delegateStateFor(projectPath, normalizedLaneId).feed || {}),
        loading: false,
        initialized: true,
        error: error.message,
      },
    }, normalizedLaneId);
  } finally {
    state.delegateFeedPending = false;
  }

  renderAll();
  return delegateStateFor(projectPath, normalizedLaneId).feed;
}

async function loadDelegateProject(
  projectPath,
  { force = false, includeRunLog = true, includeFeed = true, laneId = "default" } = {},
) {
  const normalizedLaneId = normalizeDelegateLaneId(laneId);
  if (!projectPath) {
    return delegateStateFor(projectPath, normalizedLaneId);
  }

  const existing = delegateStateFor(projectPath, normalizedLaneId);
  if (existing.loading) {
    return existing;
  }
  if (!force && existing.initialized && !delegateStateIsPending(existing)) {
    return existing;
  }

  setDelegateState(projectPath, {
    loading: true,
    error: "",
  }, normalizedLaneId);
  renderAll();

  try {
    const payload = await fetchJson(
      `/v1/delegate?project=${encodeURIComponent(projectPath)}&lane=${encodeURIComponent(normalizedLaneId)}`,
    );
    const previousRunId = selectedDelegateRunId(projectPath, existing, normalizedLaneId);
    const nextStatus = payload.status ? normalizeDelegateStatus(payload.status) : null;
    setDelegateState(projectPath, {
      ...delegatePayloadState(projectPath, payload),
      status: nextStatus,
    }, normalizedLaneId);
    updateProjectDelegateStatus(projectPath, nextStatus);
    const nextDelegateState = delegateStateFor(projectPath, normalizedLaneId);
    const nextRunId = selectedDelegateRunId(projectPath, nextDelegateState, normalizedLaneId);
    if (nextRunId) {
      state.delegateSelectedRunIds[delegateStateKey(projectPath, normalizedLaneId)] = nextRunId;
    }
    if (includeRunLog) {
      await loadDelegateRunLog(projectPath, {
        force: true,
        reset: Boolean(nextRunId && nextRunId !== previousRunId),
        runId: nextRunId,
        laneId: normalizedLaneId,
      });
    }
    if (includeFeed) {
      await loadDelegateFeed(projectPath, { force: true, laneId: normalizedLaneId });
    }
  } catch (error) {
    setDelegateState(projectPath, {
      loading: false,
      initialized: true,
      error: error.message,
    }, normalizedLaneId);
  }

  renderAll();
  return delegateStateFor(projectPath, normalizedLaneId);
}

async function openDelegateModal(projectPath = state.selectedProject, laneId = "default", options = {}) {
  if (!projectPath) {
    return;
  }

  state.modalThread = null;
  state.projectModalOpen = false;
  state.sessionImportModalProject = "";
  state.summaryModalProject = "";
  state.codexIntegrationModalProject = "";
  state.activeRunsModalOpen = false;
  state.artifactModalProject = "";
  state.sessionTitleModalProject = "";
  state.sessionTitleModalSessionId = "";
  state.delegateModalProject = projectPath;
  state.delegateModalLane = normalizeDelegateLaneId(laneId);
  state.delegateBriefPending = false;
  state.delegatePlanPending = false;
  state.delegateRunPending = false;
  state.delegateSupervisorPending = false;
  state.delegateRunSummaryPending = false;
  state.delegateFeedPending = false;
  state.delegateBriefDirty = false;
  state.delegateBriefDraft = "";
  state.delegateCarouselSlide = delegateCarouselSlides.find((slide) => slide.id === options.slide)?.id || "progress";
  renderAll();
  const loadedState = await loadDelegateProject(projectPath, { laneId: state.delegateModalLane });
  if (options.preferBriefWhenEmpty && !String(loadedState?.brief || "").trim()) {
    state.delegateCarouselSlide = "brief";
    renderAll();
  }
}

function closeDelegateModal() {
  state.delegateModalProject = "";
  state.delegateModalLane = "default";
  state.delegateBriefDraft = "";
  state.delegateBriefDirty = false;
  state.delegateBriefPending = false;
  state.delegatePlanPending = false;
  state.delegateRunPending = false;
  state.delegateSupervisorPending = false;
  state.delegateRunSummaryPending = false;
  state.delegateFeedPending = false;
  delegateRunRenderSnapshot = null;
  renderAll();
}

async function openActiveRunsModal() {
  state.modalThread = null;
  state.projectModalOpen = false;
  state.sessionImportModalProject = "";
  state.summaryModalProject = "";
  state.codexIntegrationModalProject = "";
  state.artifactModalProject = "";
  state.sessionTitleModalProject = "";
  state.sessionTitleModalSessionId = "";
  state.delegateModalProject = "";
  state.activeRunsModalOpen = true;
  renderAll();
  await primeActiveRunsModal();
}

function closeActiveRunsModal() {
  state.activeRunsModalOpen = false;
  renderAll();
}

async function selectDelegateRun(runId) {
  const project = currentDelegateProject();
  const laneId = currentDelegateLaneId();
  const selectedRunIdValue = String(runId || "").trim();
  if (!project?.path || !selectedRunIdValue) {
    return;
  }

  const stateKey = delegateStateKey(project.path, laneId);
  const previousRunId = state.delegateSelectedRunIds[stateKey] || "";
  state.delegateSelectedRunIds[stateKey] = selectedRunIdValue;
  state.delegateCarouselSlide = "details";
  delegateRunRenderSnapshot = null;
  renderAll();

  await loadDelegateRunLog(project.path, {
    force: true,
    reset: previousRunId !== selectedRunIdValue,
    runId: selectedRunIdValue,
    laneId,
  });
}

async function saveDelegateBrief({ quiet = false } = {}) {
  const project = currentDelegateProject();
  const laneId = currentDelegateLaneId();
  if (!project?.path) {
    return null;
  }

  const brief = (
    state.delegateBriefDirty ? state.delegateBriefDraft : delegateStateFor(project.path, laneId).brief || ""
  ).trim();
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
        lane: laneId,
        brief,
      }),
    });

    setDelegateState(project.path, delegatePayloadState(project.path, payload, { briefFallback: brief }), laneId);
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
  const laneId = currentDelegateLaneId();
  if (!project?.path || state.delegatePlanPending || state.delegateRunPending) {
    return;
  }

  await ensureDelegateBriefSaved();

  state.delegatePlanPending = true;
  const existing = delegateStateFor(project.path, laneId);
  setDelegateState(project.path, {
    status: normalizeDelegateStatus({
      ...(existing.status || {}),
      state: "planning",
      projectPath: project.path,
    }),
    error: "",
  }, laneId);
  renderAll();

  try {
    const payload = await fetchJson("/v1/delegate/plan", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        project: project.path,
        lane: laneId,
      }),
    });

    setDelegateState(project.path, delegatePayloadState(project.path, payload), laneId);
  } catch (error) {
    setDelegateState(project.path, {
      error: error.message,
    }, laneId);
    showError(error);
  } finally {
    state.delegatePlanPending = false;
    renderAll();
  }
}

async function toggleDelegateRun() {
  const project = currentDelegateProject();
  const laneId = currentDelegateLaneId();
  if (!project?.path || state.delegatePlanPending || state.delegateRunPending) {
    return;
  }

  const existing = delegateStateFor(project.path, laneId);
  const action =
    existing.status?.state === "running" && !existing.status?.pauseRequested ? "pause" : "start";

  if (action === "start") {
    await ensureDelegateBriefSaved();
  }

  state.delegateRunPending = true;
  state.delegateCarouselSlide = action === "pause" ? "details" : "progress";
  if (action === "pause") {
    setDelegateState(project.path, {
      status: normalizeDelegateStatus({
        ...(existing.status || {}),
        state: existing.status?.state || "running",
        pauseRequested: true,
      }),
    }, laneId);
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
        lane: laneId,
        action,
      }),
    });

    setDelegateState(project.path, delegatePayloadState(project.path, payload), laneId);
    await loadDelegateRunLog(project.path, {
      force: true,
      reset: action === "start",
      laneId,
    });
    await loadDelegateFeed(project.path, { force: true, laneId });
  } catch (error) {
    setDelegateState(project.path, {
      error: error.message,
    }, laneId);
    showError(error);
  } finally {
    state.delegateRunPending = false;
    renderAll();
  }
}

async function requestDelegateSupervisor(action) {
  const project = currentDelegateProject();
  const laneId = currentDelegateLaneId();
  const normalizedAction = ["preview", "start", "stop"].includes(action) ? action : "preview";
  if (!project?.path || state.delegatePlanPending || state.delegateRunPending || state.delegateSupervisorPending) {
    return;
  }

  if (normalizedAction !== "stop") {
    await ensureDelegateBriefSaved();
  }

  const existing = delegateStateFor(project.path, laneId);
  state.delegateSupervisorPending = normalizedAction;
  state.delegateCarouselSlide = normalizedAction === "stop" ? "details" : "progress";
  if (normalizedAction === "start") {
    setDelegateState(project.path, {
      supervisor: normalizeDelegateSupervisorState({
        ...(existing.supervisor || {}),
        laneId,
        projectPath: project.path,
        enabled: true,
        state: "running",
      }),
      supervisorPreview: null,
      error: "",
    }, laneId);
  } else if (normalizedAction === "stop") {
    setDelegateState(project.path, {
      status: normalizeDelegateStatus({
        ...(existing.status || {}),
        state: existing.status?.state || "running",
        pauseRequested: existing.status?.state === "running" || existing.status?.pauseRequested,
      }),
      supervisor: normalizeDelegateSupervisorState({
        ...(existing.supervisor || {}),
        laneId,
        projectPath: project.path,
        enabled: false,
        state: "stopped",
      }),
      error: "",
    }, laneId);
  }
  renderAll();

  try {
    const payload = await fetchJson("/v1/delegate/supervise", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        project: project.path,
        lane: laneId,
        action: normalizedAction,
      }),
    });

    setDelegateState(project.path, delegatePayloadState(project.path, payload), laneId);
    if (payload.status) {
      updateProjectDelegateStatus(project.path, payload.status);
    }
    if (normalizedAction !== "preview") {
      await loadDelegateRunLog(project.path, {
        force: true,
        reset: normalizedAction === "start",
        laneId,
      });
      await loadDelegateFeed(project.path, { force: true, laneId });
      void refreshProjects().catch(() => {});
    }
  } catch (error) {
    setDelegateState(project.path, {
      supervisor: existing.supervisor || null,
      status: existing.status || null,
      error: error.message,
    }, laneId);
    showError(error);
  } finally {
    state.delegateSupervisorPending = false;
    renderAll();
  }
}

async function toggleDelegateSupervisor() {
  const project = currentDelegateProject();
  const laneId = currentDelegateLaneId();
  const delegateState = delegateStateFor(project?.path || "", laneId);
  const statusState = String(delegateState?.status?.state || "").toLowerCase();
  const shouldStop =
    delegateSupervisorIsActive(delegateState) ||
    statusState === "running" ||
    statusState === "planning" ||
    Boolean(delegateState?.status?.pauseRequested);
  await requestDelegateSupervisor(shouldStop ? "stop" : "start");
}

async function requestDelegateRunSummary() {
  const project = currentDelegateProject();
  const laneId = currentDelegateLaneId();
  if (!project?.path || state.delegateRunSummaryPending) {
    return;
  }

  const delegateState = delegateStateFor(project.path, laneId);
  const runId = selectedDelegateRunId(project.path, delegateState, laneId);
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
        lane: laneId,
        runId,
      }),
    });

    setDelegateState(project.path, {
      latestRunSummarySnapshot: payload.latestRunSummarySnapshot
        ? normalizeDelegateRunSummarySnapshot(payload.latestRunSummarySnapshot)
        : delegateStateFor(project.path, laneId).latestRunSummarySnapshot,
      runSummarySnapshots: Array.isArray(payload.runSummarySnapshots)
        ? payload.runSummarySnapshots.map(normalizeDelegateRunSummarySnapshot)
        : delegateStateFor(project.path, laneId).runSummarySnapshots,
    }, laneId);
  } catch (error) {
    setDelegateState(project.path, {
      error: error.message,
    }, laneId);
    showError(error);
  } finally {
    state.delegateRunSummaryPending = false;
    renderAll();
  }
}

async function requestDelegateLanePause(projectPath, laneId = "default") {
  const normalizedLaneId = normalizeDelegateLaneId(laneId);
  const existing = delegateStateFor(projectPath, normalizedLaneId);
  const nextStatus = normalizeDelegateStatus({
    ...(existing.status || {}),
    state: existing.status?.state || "running",
    pauseRequested: true,
  });

  setDelegateState(projectPath, { status: nextStatus }, normalizedLaneId);
  updateProjectDelegateStatus(projectPath, nextStatus);
  renderAll();

  try {
    const payload = await fetchJson("/v1/delegate/supervise", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        project: projectPath,
        lane: normalizedLaneId,
        action: "stop",
      }),
    });

    setDelegateState(projectPath, delegatePayloadState(projectPath, payload), normalizedLaneId);
    if (payload.status) {
      updateProjectDelegateStatus(projectPath, payload.status);
    }
    await loadDelegateRunLog(projectPath, { force: true, laneId: normalizedLaneId });
    await loadDelegateFeed(projectPath, { force: true, laneId: normalizedLaneId });
    void refreshProjects().catch(() => {});
  } catch (error) {
    setDelegateState(projectPath, {
      status: existing.status || null,
      error: error.message,
    }, normalizedLaneId);
    if (existing.status) {
      updateProjectDelegateStatus(projectPath, existing.status);
    }
    showError(error);
  } finally {
    renderAll();
  }
}

function setProjectModalMode(mode) {
  state.projectModalMode = mode === "new" ? "new" : "existing";
  state.projectModalStatus = "";
  syncProjectRepoSelection("", { preferCurrent: false });
  renderAll();
}

function closeQuickPromptEditor() {
  state.quickPromptDraftMode = "";
  state.quickPromptDraftId = "";
  state.quickPromptDraftTitle = "";
  state.quickPromptDraftText = "";
  state.quickPromptResetConfirm = false;
}

function openQuickPromptCreate() {
  state.quickPromptDraftMode = "new";
  state.quickPromptDraftId = "";
  state.quickPromptDraftTitle = "";
  state.quickPromptDraftText = "";
  state.quickPromptError = "";
  state.quickPromptResetConfirm = false;
  renderAll();
  window.setTimeout(() => elements.quickPromptTitleInput?.focus(), 0);
}

function openQuickPromptEdit(promptId) {
  const prompt = state.quickPrompts.find((entry) => entry.id === promptId);
  if (!prompt) {
    return;
  }
  state.quickPromptDraftMode = "edit";
  state.quickPromptDraftId = prompt.id;
  state.quickPromptDraftTitle = prompt.title;
  state.quickPromptDraftText = prompt.text;
  state.quickPromptError = "";
  state.quickPromptResetConfirm = false;
  renderAll();
  window.setTimeout(() => elements.quickPromptTitleInput?.focus(), 0);
}

function openComposerToolsMenu() {
  state.composerToolsOpen = true;
  renderAll();
}

function closeComposerToolsMenu({ focusComposer = false } = {}) {
  state.composerToolsOpen = false;
  renderAll();
  if (focusComposer) {
    window.setTimeout(() => elements.messageInput?.focus(), 0);
  }
}

function toggleComposerToolsMenu() {
  if (state.composerToolsOpen) {
    closeComposerToolsMenu({ focusComposer: false });
    return;
  }
  openComposerToolsMenu();
}

function isComposerToolsTarget(target) {
  if (!(target instanceof Node)) {
    return false;
  }
  return Boolean(
    elements.composerToolsButton?.contains(target) ||
      elements.composerToolsMenu?.contains(target),
  );
}

function openQuickPromptModal() {
  state.composerToolsOpen = false;
  state.quickPromptModalOpen = true;
  state.quickPromptError = "";
  state.quickPromptResetConfirm = false;
  renderAll();
  void loadQuickPrompts();
}

function closeQuickPromptModal({ focusComposer = true } = {}) {
  state.quickPromptModalOpen = false;
  state.quickPromptError = "";
  state.quickPromptResetConfirm = false;
  closeQuickPromptEditor();
  renderAll();
  if (focusComposer) {
    window.setTimeout(() => elements.messageInput?.focus(), 0);
  }
}

function isQuickPromptTarget(target) {
  if (!(target instanceof Node)) {
    return false;
  }
  return Boolean(
    elements.quickPromptModal?.contains(target) ||
      elements.quickPromptButton?.contains(target),
  );
}

function appendQuickPromptToComposer(text) {
  const promptText = String(text || "").trim();
  if (!promptText) {
    return;
  }
  const current = String(elements.messageInput.value || "");
  elements.messageInput.value = current.trim()
    ? `${current.trimEnd()}\n\n${promptText}`
    : promptText;
  elements.messageInput.focus();
  elements.messageInput.setSelectionRange(elements.messageInput.value.length, elements.messageInput.value.length);
  updateSendAvailability();
}

function insertQuickPrompt(promptId) {
  const prompt = state.quickPrompts.find((entry) => entry.id === promptId);
  if (!prompt) {
    return;
  }
  appendQuickPromptToComposer(prompt.text);
  closeQuickPromptModal();
}

function saveQuickPromptDraft() {
  const title = String(elements.quickPromptTitleInput.value || "").trim();
  const text = String(elements.quickPromptTextInput.value || "").trim();
  if (!title || !text) {
    state.quickPromptError = "Quick prompts need a title and prompt text.";
    renderAll();
    return;
  }
  const prompt = {
    id: state.quickPromptDraftMode === "edit" ? state.quickPromptDraftId : newQuickPromptId(),
    title,
    text,
    builtIn: state.quickPrompts.find((entry) => entry.id === state.quickPromptDraftId)?.builtIn === true,
  };
  const prompts =
    state.quickPromptDraftMode === "edit"
      ? state.quickPrompts.map((entry) => (entry.id === state.quickPromptDraftId ? prompt : entry))
      : [...state.quickPrompts, prompt];
  void saveQuickPrompts(prompts);
}

async function selectProjectPath(projectPath) {
  const normalizedPath = String(projectPath || "").trim();
  if (!normalizedPath || normalizedPath === state.selectedProject) {
    return;
  }
  clearControlInteraction("project-select");
  state.selectedProject = normalizedPath;
  syncSelectedSession("", { preferCurrent: false });
  state.threadPreviewError = "";
  renderAll();
  try {
    const selected = currentProject();
    if (selected?.untracked) {
      await ensureProjectTrackedFromSelection(selected);
    }
    void refreshRecentHistory({ force: true, project: state.selectedProject }).catch(() => {});
    await refreshThreads();
  } catch (error) {
    showError(error);
    await refreshProjects().catch(() => {});
  }
}

function openProjectPicker({ returnFocus = document.activeElement } = {}) {
  projectPickerReturnFocus = returnFocus instanceof HTMLElement
    ? returnFocus
    : elements.projectPickerButton;
  state.summaryModalProject = "";
  state.codexIntegrationModalProject = "";
  state.sessionImportModalProject = "";
  state.activeRunsModalOpen = false;
  state.artifactModalProject = "";
  state.delegateModalProject = "";
  state.sessionTitleModalProject = "";
  state.sessionTitleModalSessionId = "";
  state.quickPromptModalOpen = false;
  state.composerToolsOpen = false;
  state.modalThread = null;
  state.projectModalOpen = false;
  state.projectPickerQuery = "";
  state.projectPickerOpen = true;
  renderAll();
  window.requestAnimationFrame(() => elements.projectPickerSearchInput?.focus());
}

function closeProjectPicker({ restoreFocus = true } = {}) {
  const focusTarget = projectPickerReturnFocus || elements.projectPickerButton;
  state.projectPickerOpen = false;
  state.projectPickerQuery = "";
  renderAll();
  if (restoreFocus) {
    window.requestAnimationFrame(() => focusTarget?.focus());
  }
}

async function openProjectModal({
  mode = "new",
  returnToPicker = false,
  returnFocus = document.activeElement,
} = {}) {
  projectModalReturnFocus = returnFocus instanceof HTMLElement
    ? returnFocus
    : mode === "new"
      ? elements.projectAddButton
      : elements.projectPickerAddExistingButton;
  state.summaryModalProject = "";
  state.codexIntegrationModalProject = "";
  state.sessionImportModalProject = "";
  state.activeRunsModalOpen = false;
  state.artifactModalProject = "";
  state.delegateModalProject = "";
  state.sessionTitleModalProject = "";
  state.sessionTitleModalSessionId = "";
  state.quickPromptModalOpen = false;
  state.modalThread = null;
  state.projectPickerOpen = false;
  state.projectModalOpen = true;
  state.projectModalMode = mode === "existing" ? "existing" : "new";
  state.projectModalReturnToPicker = Boolean(returnToPicker);
  state.projectModalName = "";
  state.projectModalRepoPath = "";
  state.projectModalStatus = "";
  state.projectModalRoot = state.workspace?.primaryRoot || state.projectModalRoot || "";
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
  window.requestAnimationFrame(() => {
    if (state.projectModalMode === "new") {
      elements.projectNameInput?.focus();
    } else {
      elements.projectRepoSelect?.focus();
    }
  });
}

function closeProjectModal({ restoreFocus = true, force = false } = {}) {
  if (state.projectModalPending && !force) {
    return false;
  }
  const returnToPicker = state.projectModalReturnToPicker;
  const focusTarget = projectModalReturnFocus || elements.projectAddButton;
  state.projectModalOpen = false;
  state.projectModalPending = false;
  state.projectModalStatus = "";
  state.projectModalReturnToPicker = false;
  if (returnToPicker) {
    state.projectPickerOpen = true;
  }
  renderAll();
  if (restoreFocus) {
    window.requestAnimationFrame(() => {
      if (returnToPicker) {
        elements.projectPickerAddExistingButton?.focus();
      } else {
        focusTarget?.focus();
      }
    });
  }
  return true;
}

function openSettingsModal() {
  state.summaryModalProject = "";
  state.codexIntegrationModalProject = "";
  state.sessionImportModalProject = "";
  state.activeRunsModalOpen = false;
  state.artifactModalProject = "";
  state.delegateModalProject = "";
  state.sessionTitleModalProject = "";
  state.sessionTitleModalSessionId = "";
  state.quickPromptModalOpen = false;
  state.composerToolsOpen = false;
  state.modalThread = null;
  state.projectPickerOpen = false;
  state.projectModalOpen = false;
  state.settingsModalOpen = true;
  state.remoteAssistInfoOpen = false;
  state.settingsWorkspaceStatus = "";
  state.settingsWorkspacePending = false;
  syncSettingsWorkspaceDraftsFromWorkspace();
  renderAll();
  window.requestAnimationFrame(() => {
    elements.settingsScratchpadInput?.focus();
    elements.settingsScratchpadInput?.select();
  });
  if (state.projectRoots.length === 0) {
    void refreshProjectRoots().catch((error) => {
      state.settingsWorkspaceStatus = error.message;
      renderAll();
    });
  }
  void refreshVoiceInputDevices({ quiet: true });
  void refreshDesktopAppStatus();
  void refreshSubscriptionEntitlement();
  void refreshRemoteAssistStatus();
  void refreshCloudDevices({ quiet: true });
  void refreshRemoteComputers({ quiet: true });
}

function closeSettingsModal({ restoreFocus = true } = {}) {
  if (state.directoryPickerPending || state.directoryBrowserOpen) {
    return;
  }
  state.settingsModalOpen = false;
  state.remoteAssistInfoOpen = false;
  state.remotePairingOpen = false;
  state.remotePairingCode = "";
  state.settingsWorkspacePending = false;
  state.settingsWorkspaceStatus = "";
  state.settingsWorkspaceNewRootDraft = "";
  renderAll();
  if (restoreFocus) {
    elements.settingsButton?.focus();
  }
}

function addSettingsWorkspaceRoot() {
  const rootPath = state.settingsWorkspaceNewRootDraft.trim();
  if (!rootPath) {
    return;
  }
  state.settingsWorkspaceRootDrafts = normalizeWorkspaceRootDrafts([
    ...state.settingsWorkspaceRootDrafts,
    rootPath,
  ]);
  state.settingsWorkspaceNewRootDraft = "";
  state.settingsWorkspaceStatus = "";
  renderAll();
}

function closeDirectoryBrowser({ restoreFocus = true } = {}) {
  const purpose = state.directoryBrowserPurpose;
  state.directoryBrowserOpen = false;
  state.directoryBrowserPurpose = "";
  state.directoryBrowserPath = "";
  state.directoryBrowserPathDraft = "";
  state.directoryBrowserParent = "";
  state.directoryBrowserEntries = [];
  state.directoryBrowserRoots = [];
  state.directoryBrowserQuery = "";
  state.directoryBrowserLoading = false;
  state.directoryBrowserStatus = "";
  renderAll();
  if (!restoreFocus) {
    return;
  }
  if (purpose === "scratchpad") {
    elements.settingsScratchpadChooseButton?.focus();
  } else if (purpose === "setup") {
    elements.workspaceRootChooseButton?.focus();
  } else {
    elements.settingsChooseRootButton?.focus();
  }
}

async function loadDirectoryBrowserPath(folderPath = "") {
  const requestedPath = String(folderPath || state.directoryBrowserPathDraft || "").trim();
  state.directoryBrowserLoading = true;
  state.directoryBrowserStatus = requestedPath ? `Opening ${requestedPath}` : "Loading folders";
  renderAll();
  try {
    const query = requestedPath ? `?path=${encodeURIComponent(requestedPath)}` : "";
    const payload = await fetchJson(`/v1/workspace/directories${query}`);
    state.directoryBrowserPath = String(payload.path || "");
    state.directoryBrowserPathDraft = state.directoryBrowserPath;
    state.directoryBrowserParent = String(payload.parent || "");
    state.directoryBrowserEntries = Array.isArray(payload.entries) ? payload.entries : [];
    state.directoryBrowserRoots = Array.isArray(payload.roots) ? payload.roots : [];
    state.directoryBrowserQuery = "";
    state.directoryBrowserStatus = payload.truncated
      ? "Showing first folders only. Search or type a deeper path."
      : "";
  } catch (error) {
    state.directoryBrowserStatus = error.message;
    showError(error);
  } finally {
    state.directoryBrowserLoading = false;
    renderAll();
  }
}

function applyWorkspaceDirectorySelection(selectedPath, purpose = state.directoryBrowserPurpose) {
  if (purpose === "setup") {
    state.workspaceSetupDraft = selectedPath;
    state.workspaceSetupStatus = "";
  } else if (purpose === "scratchpad") {
    state.settingsWorkspaceFocusDraft = selectedPath;
    state.settingsWorkspaceStatus = "";
  } else {
    state.settingsWorkspaceRootDrafts = normalizeWorkspaceRootDrafts([
      ...state.settingsWorkspaceRootDrafts,
      selectedPath,
    ]);
    state.settingsWorkspaceNewRootDraft = "";
    state.settingsWorkspaceStatus = "";
  }
}

function openWorkspaceDirectoryBrowser({ purpose, defaultPath = "" } = {}) {
  const browserPurpose = purpose || "project-root";
  state.directoryBrowserOpen = true;
  state.directoryBrowserPurpose = browserPurpose;
  state.directoryBrowserPath = "";
  state.directoryBrowserPathDraft = String(defaultPath || "").trim();
  state.directoryBrowserParent = "";
  state.directoryBrowserEntries = [];
  state.directoryBrowserRoots = [];
  state.directoryBrowserQuery = "";
  state.directoryBrowserLoading = false;
  state.directoryBrowserStatus = "";
  renderAll();
  window.requestAnimationFrame(() => {
    elements.directoryBrowserSearchInput?.focus();
  });
  void loadDirectoryBrowserPath(state.directoryBrowserPathDraft);
}

async function chooseWorkspaceDirectory({ purpose, defaultPath = "" } = {}) {
  const pickerPurpose = purpose || "project-root";
  if (!nativeBridge.isAvailable()) {
    openWorkspaceDirectoryBrowser({ purpose: pickerPurpose, defaultPath });
    return;
  }

  state.directoryPickerPending = pickerPurpose;
  renderAll();
  try {
    const result = await nativeBridge.chooseFolder({
      purpose: pickerPurpose,
      defaultPath: String(defaultPath || "").trim(),
    });
    if (!result?.cancelled && result?.path) {
      applyWorkspaceDirectorySelection(String(result.path), pickerPurpose);
    }
  } catch (error) {
    showError(error);
    openWorkspaceDirectoryBrowser({ purpose: pickerPurpose, defaultPath });
  } finally {
    state.directoryPickerPending = "";
    renderAll();
  }
}

function useDirectoryBrowserFolder() {
  const selectedPath = state.directoryBrowserPath.trim();
  if (!selectedPath) {
    state.directoryBrowserStatus = "Choose a folder first";
    renderAll();
    return;
  }

  applyWorkspaceDirectorySelection(selectedPath, state.directoryBrowserPurpose);
  closeDirectoryBrowser();
}

async function saveWorkspaceSettings() {
  if (state.directoryPickerPending || state.directoryBrowserOpen) {
    return;
  }
  const primaryRoot = state.settingsWorkspaceFocusDraft.trim();
  const projectRoots = settingsWorkspaceRootDrafts();
  if (!primaryRoot) {
    state.settingsWorkspaceStatus = "Choose a Scratchpad Focus";
    renderAll();
    return;
  }

  state.settingsWorkspacePending = true;
  state.settingsWorkspaceStatus = "Checking folders…";
  renderAll();
  try {
    const payload = await fetchJson("/v1/workspace", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        primaryRoot,
        projectRoots,
      }),
    });
    applyWorkspacePayload(payload.workspace);
    syncSettingsWorkspaceDraftsFromWorkspace();
    state.settingsWorkspaceStatus = "Saved";
    await refreshProjectRoots();
    await refreshProjects();
  } catch (error) {
    state.settingsWorkspaceStatus = error.message;
    showError(error);
  } finally {
    state.settingsWorkspacePending = false;
    renderAll();
  }
}

async function startCloudPairing() {
  if (state.cloudPairingPending) {
    return;
  }
  state.cloudPairingPending = true;
  state.cloudPairingStatus = "Generating secure QR...";
  state.cloudPairingQrSvg = "";
  state.cloudPairingCode = "";
  state.cloudPairingExpiresAt = "";
  renderAll();
  try {
    const payload = await fetchJson("/v1/cloud/pairing", {
      method: "POST",
    });
    state.cloudPairingQrSvg = String(payload.qrSvg || "");
    state.cloudPairingCode = payload.pairing
      ? JSON.stringify(payload.pairing)
      : "";
    state.cloudPairingExpiresAt = String(payload.pairing?.expiresAt || "");
    state.cloudPairingStatus = state.cloudPairingQrSvg
      ? "Scan this on iPhone, or copy the code into ClawDad on another Mac."
      : "Pairing code generated for another ClawDad device.";
  } catch (error) {
    state.cloudPairingStatus = error.message;
    showError(error);
  } finally {
    state.cloudPairingPending = false;
    renderAll();
  }
}

async function copyCloudPairingCode() {
  if (!state.cloudPairingCode) {
    return;
  }
  try {
    await copyText(state.cloudPairingCode);
    state.cloudPairingStatus = "Pairing code copied. Paste it into ClawDad on the other Mac.";
  } catch (error) {
    state.cloudPairingStatus = String(error?.message || "Unable to copy the pairing code.");
    showError(error);
  } finally {
    renderAll();
  }
}

async function refreshRemoteComputers({ quiet = false } = {}) {
  if (!nativeBridge.isAvailable() || state.remoteComputersPending) {
    return;
  }
  if (!quiet) {
    state.remoteComputersPending = true;
    state.remoteComputersStatus = "Checking paired computers...";
    renderAll();
  }
  try {
    applyRemoteComputersStatus(await nativeBridge.getRemoteComputers());
    if (!quiet) {
      state.remoteComputersStatus = "";
    }
  } catch (error) {
    state.remoteComputersStatus = String(error?.message || "Unable to load paired computers.");
    if (!quiet) {
      showError(error);
    }
  } finally {
    state.remoteComputersPending = false;
    renderAll();
  }
}

async function pairRemoteComputer() {
  const code = state.remotePairingCode.trim();
  if (!code || state.remoteComputersPending) {
    return;
  }
  state.remoteComputersPending = true;
  state.remoteComputersStatus = "Verifying the other Mac...";
  renderAll();
  try {
    const result = await nativeBridge.pairRemoteComputer(code);
    applyRemoteComputersStatus(result?.status);
    const name = String(result?.computer?.displayName || "the other Mac");
    state.remoteComputersStatus = `Paired securely with ${name}.`;
    state.remotePairingCode = "";
    state.remotePairingOpen = false;
  } catch (error) {
    state.remoteComputersStatus = String(error?.message || "Pairing failed.");
    showError(error);
  } finally {
    state.remoteComputersPending = false;
    renderAll();
  }
}

async function openRemoteComputer(computerId) {
  if (!computerId || state.remoteComputersPending) {
    return;
  }
  state.remoteComputersPending = true;
  state.remoteComputersStatus = "Opening Remote Assist...";
  renderAll();
  try {
    await nativeBridge.openRemoteComputer(computerId);
    state.remoteComputersStatus = "Remote Assist opened in a new window.";
  } catch (error) {
    state.remoteComputersStatus = String(error?.message || "Remote Assist could not open.");
    showError(error);
  } finally {
    state.remoteComputersPending = false;
    renderAll();
  }
}

async function forgetRemoteComputer(computerId) {
  if (!computerId || state.remoteComputersPending) {
    return;
  }
  state.remoteComputersPending = true;
  state.remoteComputersStatus = "Removing this computer...";
  renderAll();
  try {
    applyRemoteComputersStatus(await nativeBridge.forgetRemoteComputer(computerId));
    state.remoteComputersStatus = "Computer forgotten. You can pair it again at any time.";
  } catch (error) {
    state.remoteComputersStatus = String(error?.message || "Unable to forget this computer.");
    showError(error);
  } finally {
    state.remoteComputersPending = false;
    renderAll();
  }
}

async function refreshCloudDevices({ quiet = false } = {}) {
  if (state.cloudDevicesPending) {
    return;
  }
  state.cloudDevicesPending = true;
  if (!quiet) {
    state.cloudDevicesStatus = "";
  }
  renderAll();
  try {
    const payload = await fetchJson("/v1/cloud/devices");
    state.cloudDevices = Array.isArray(payload.devices)
      ? payload.devices.filter((device) => !device.revokedAt)
      : [];
    state.cloudDevicesStatus = "";
  } catch (error) {
    state.cloudDevicesStatus = error.message;
    if (!quiet) {
      showError(error);
    }
  } finally {
    state.cloudDevicesPending = false;
    renderAll();
  }
}

async function forgetCloudDevice(deviceId) {
  const normalizedDeviceId = String(deviceId || "").trim();
  if (!normalizedDeviceId || state.cloudDevicesPending) {
    return;
  }
  state.cloudDevicesPending = true;
  state.cloudDevicesStatus = "Revoking device access...";
  renderAll();
  try {
    await fetchJson(`/v1/cloud/devices/${encodeURIComponent(normalizedDeviceId)}`, {
      method: "DELETE",
    });
    state.cloudDevices = state.cloudDevices.filter(
      (device) => device.deviceId !== normalizedDeviceId,
    );
    state.cloudDevicesStatus = state.cloudDevices.length === 0
      ? "No devices are paired yet."
      : "";
  } catch (error) {
    state.cloudDevicesStatus = error.message;
    showError(error);
  } finally {
    state.cloudDevicesPending = false;
    renderAll();
  }
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

async function ensureProjectTrackedFromSelection(project) {
  if (!project?.untracked || !project.path) {
    return project;
  }
  const rootPath = project.workspaceRootPath || workspaceRootForProjectPath(project.path)?.path || "";
  if (!rootPath) {
    throw new Error("Project folder is outside configured workspace roots");
  }

  const payload = await fetchJson("/v1/projects", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      mode: "existing",
      root: rootPath,
      path: project.path,
      provider: project.provider || "codex",
    }),
  });

  if (payload.projectDetails) {
    upsertProject(hydrateProjectVisuals(payload.projectDetails));
    state.selectedProject = payload.projectDetails.path;
    syncSelectedSession(payload.sessionId || payload.projectDetails.activeSessionId || "", {
      preferCurrent: false,
    });
  } else {
    await refreshProjects();
  }
  void refreshProjectRoots().catch(() => {});
  return currentProject();
}

async function handleProjectCreate(event) {
  event.preventDefault();

  if (state.projectModalPending) {
    return;
  }

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
    state.projectModalStatus = "Enter a project directory name.";
    renderAll();
    return;
  }

  if (mode === "new" && !projectDirectoryNameIsValid(projectName)) {
    state.projectModalStatus = "Use one visible folder name without slashes. Names cannot begin with a period.";
    renderAll();
    return;
  }

  state.projectModalPending = true;
  state.projectModalStatus = mode === "new"
    ? "Creating the folder and first Codex thread…"
    : "Adding the project and preparing its Codex thread…";
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
      upsertProject(hydrateProjectVisuals(payload.projectDetails));
      state.selectedProject = payload.projectDetails.path;
      syncSelectedSession(payload.sessionId || payload.projectDetails.activeSessionId || "", {
        preferCurrent: false,
      });
    } else {
      await refreshProjects();
    }

    state.projectModalName = "";
    state.projectModalRepoPath = "";
    state.projectModalPending = false;
    state.projectModalStatus = "";
    state.projectModalReturnToPicker = false;
    state.projectModalOpen = false;
    state.projectPickerOpen = false;
    void refreshProjectRoots().catch(() => {});
    void refreshProjects().catch(() => {});
    renderAll();
    window.requestAnimationFrame(() => elements.projectPickerButton?.focus());
  } catch (error) {
    state.projectModalPending = false;
    state.projectModalStatus = error.message || "ClawDad could not create this project.";
    renderAll();
    console.error(error);
  }
}

async function handleDispatch(event) {
  event.preventDefault();

  const project = state.selectedProject;
  const sessionId = state.selectedSessionId;
  const message = elements.messageInput.value.trim();
  const composerAttachments = [...state.composerAttachments];
  const hasAttachments = composerAttachments.length > 0;
  const dispatchMessage = message || (hasAttachments ? "Please review the attached file(s)." : "");
  const projectDetails = currentProject();
  const sessionDetails = currentSession();
  const dispatchMode = normalizeDispatchMode(state.dispatchMode);
  const permissionMode = permissionModeForAccessMode();
  const allowBusySend = dispatchModeAllowsBusySend(dispatchMode);

  if (!project) {
    showError(new Error("Select a project."));
    return;
  }
  if (!sessionId) {
    showError(new Error("Select a session."));
    return;
  }
  if (!dispatchMessage) {
    showError(new Error("Write a message or attach a file."));
    return;
  }

  if (!allowBusySend && pendingEntryForSession(project, sessionId)) {
    renderAll();
    return;
  }

  if (!allowBusySend && sessionIsBusy(sessionDetails)) {
    showError(new Error("This session is busy."));
    return;
  }

  const entry = {
    id: makeEntryId(),
    projectPath: project,
    sessionId,
    projectLabel: projectDetails?.displayName || projectDetails?.slug || fallbackProjectLabel(project),
    sessionLabel: sessionOptionLabel(sessionDetails, project),
    message: dispatchMessage,
    attachments: composerAttachments.map(composerAttachmentSummary),
    requestId: "",
    queueId: null,
    requestState: dispatchMode === "queue" ? "queued" : "starting",
    handoffPending: true,
    status: dispatchMode === "queue" ? "queued" : "working",
    scheduleMode: dispatchMode,
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
    const requestOptions = hasAttachments
      ? (() => {
          const formData = new FormData();
          formData.append("project", project);
          formData.append("sessionId", sessionId);
          formData.append("message", dispatchMessage);
          formData.append("wait", "false");
          formData.append("dispatchMode", dispatchMode);
          formData.append("permissionMode", permissionMode);
          for (const attachment of composerAttachments) {
            formData.append("attachments", attachment.file, attachment.fileName);
          }
          return {
            method: "POST",
            body: formData,
          };
        })()
      : {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            project,
            sessionId,
            message: dispatchMessage,
            wait: false,
            dispatchMode,
            permissionMode,
          }),
        };
    const payload = await fetchJson("/v1/dispatch", requestOptions);
    const directAccepted = Boolean(payload.direct || payload.interjected);
    const effectiveScheduleMode =
      normalizeHistoryScheduleMode(payload.effectiveDispatchMode || payload.dispatchMode || payload.scheduleMode) ||
      (directAccepted ? "direct" : dispatchMode);
    const payloadRequestId = String(payload.requestId || payload.queueId || "").trim();
    const handoffPending = Boolean(payload.handoffPending) && !directAccepted;

    updateThreadEntry(entry.id, {
      requestId: payloadRequestId,
      queueId: String(payload.queueId || "").trim() || null,
      requestState: String(payload.requestState || (handoffPending ? "starting" : "running")).trim().toLowerCase(),
      handoffPending,
      scheduleMode: effectiveScheduleMode,
      status: effectiveScheduleMode === "queue" ? "queued" : "working",
      deliveryMechanism: String(payload.deliveryMechanism || "").trim().toLowerCase(),
      attachments: Array.isArray(payload.attachments) && payload.attachments.length > 0
        ? payload.attachments
        : entry.attachments,
    });
    hydrateHistoryFromThreadEntry(entryById(entry.id) || entry);

    elements.messageInput.value = "";
    clearComposerAttachments();
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
    completeThreadEntry(entry, {
      status: "failed",
      requestState: "failed",
      handoffPending: false,
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

function goBackOneStep() {
  if (systemSetupIsOpen()) {
    return goBackSystemSetup();
  }
  if (terminalPanelIsOpen()) {
    closeTerminalStreamPanel();
    return true;
  }
  if (state.queueArchiveConfirmEntryId) {
    closeQueueArchiveConfirm();
    return true;
  }
  if (state.projectModalOpen) {
    closeProjectModal();
    return true;
  }
  if (state.projectPickerOpen) {
    closeProjectPicker();
    return true;
  }
  if (currentModalThread()) {
    closeSessionThread();
    return true;
  }
  if (state.sessionImportModalProject) {
    closeSessionImportModal();
    return true;
  }
  if (state.summaryModalProject) {
    closeProjectSummary();
    return true;
  }
  if (state.codexIntegrationModalProject) {
    closeCodexIntegration();
    return true;
  }
  if (state.activeRunsModalOpen) {
    closeActiveRunsModal();
    return true;
  }
  if (state.artifactModalProject) {
    closeArtifactsModal();
    return true;
  }
  if (state.delegateModalProject) {
    closeDelegateModal();
    return true;
  }
  if (state.sessionTitleModalProject) {
    closeSessionTitleModal();
    return true;
  }
  if (state.directoryBrowserOpen) {
    closeDirectoryBrowser();
    return true;
  }
  if (state.remoteAssistInfoOpen) {
    setRemoteAssistInfoOpen(false, { restoreFocus: true });
    return true;
  }
  if (state.settingsModalOpen) {
    closeSettingsModal();
    return true;
  }
  if (state.quickPromptModalOpen) {
    closeQuickPromptModal();
    return true;
  }
  if (state.composerToolsOpen) {
    closeComposerToolsMenu();
    return true;
  }
  return false;
}

function bindEvents() {
  if (elements.headerCarouselButton) {
    elements.headerCarouselButton.addEventListener("click", () => {
      void advanceHeaderCarousel();
    });
  }
  elements.projectWorkspaceTab?.addEventListener("click", () => {
    setWorkspaceMode("project");
  });
  elements.autoWorkspaceTab?.addEventListener("click", () => {
    setWorkspaceMode("auto");
  });
  elements.summaryWorkspaceTab?.addEventListener("click", () => {
    if (elements.summaryWorkspaceTab.disabled) {
      return;
    }
    void openProjectSummary();
  });
  elements.composerToolsButton?.addEventListener("click", toggleComposerToolsMenu);
  for (const button of elements.dispatchModeButtons) {
    button.addEventListener("click", () => {
      setDispatchMode(button.dataset.dispatchMode, { closeTools: true });
    });
  }
  elements.composerAccessSelect?.addEventListener("change", (event) => {
    setAccessMode(event.target.value);
  });
  elements.projectSummaryButton?.addEventListener("click", () => {
    void openProjectSummary();
  });
  elements.projectCodexButton?.addEventListener("click", () => {
    void openCodexIntegration();
  });
  elements.codexIntegrationBackdrop?.addEventListener("click", closeCodexIntegration);
  elements.codexIntegrationClose?.addEventListener("click", closeCodexIntegration);
  elements.codexIntegrationRefreshButton?.addEventListener("click", () => {
    const project = currentCodexIntegrationProject();
    if (project?.path) {
      void loadCodexIntegration(project.path, { force: true });
    }
  });
  elements.codexIntegrationInstallButton?.addEventListener("click", () => {
    void installCodexIntegrationForCurrentProject();
  });
  elements.activeRunsButton?.addEventListener("click", () => {
    void openActiveRunsModal();
  });
  elements.projectAddButton.addEventListener("click", () => {
    void openProjectModal({
      mode: "new",
      returnFocus: elements.projectAddButton,
    });
  });
  elements.projectPickerButton?.addEventListener("click", () => {
    openProjectPicker({ returnFocus: elements.projectPickerButton });
  });
  elements.projectPickerBackdrop?.addEventListener("click", () => closeProjectPicker());
  elements.projectPickerClose?.addEventListener("click", () => closeProjectPicker());
  elements.projectPickerAddExistingButton?.addEventListener("click", () => {
    void openProjectModal({
      mode: "existing",
      returnToPicker: true,
      returnFocus: elements.projectPickerAddExistingButton,
    });
  });
  elements.projectPickerSearchInput?.addEventListener("input", (event) => {
    state.projectPickerQuery = String(event.target.value || "");
    renderAll();
  });
  elements.quickPromptButton?.addEventListener("click", () => {
    if (state.quickPromptModalOpen) {
      closeQuickPromptModal();
      return;
    }
    openQuickPromptModal();
  });
  document.addEventListener("pointerdown", (event) => {
    if (state.composerToolsOpen && !isComposerToolsTarget(event.target)) {
      closeComposerToolsMenu({ focusComposer: false });
    }
    if (!state.quickPromptModalOpen || isQuickPromptTarget(event.target)) {
      return;
    }
    closeQuickPromptModal({ focusComposer: false });
  });
  elements.currentTerminalButton?.addEventListener("click", () => {
    closeComposerToolsMenu({ focusComposer: false });
    void openSessionInTerminal(currentSessionTerminalEntry());
  });
  elements.composerVoiceButton?.addEventListener("click", handleComposerVoiceButtonClick);
  elements.composerVoiceCaptureInput?.addEventListener("change", (event) => {
    const file = event.target.files?.[0] || null;
    event.target.value = "";
    if (file) {
      void transcribeComposerVoice(file, {
        fileName: file.name || "clawdad-voice.webm",
        mimeType: file.type || "",
      });
    }
  });
  elements.composerAttachmentButton?.addEventListener("click", () => {
    closeComposerToolsMenu({ focusComposer: false });
    elements.composerAttachmentInput?.click();
  });
  elements.composerAttachmentInput?.addEventListener("change", (event) => {
    addComposerFiles(event.target.files);
    event.target.value = "";
  });
  elements.composerAttachmentList?.addEventListener("click", (event) => {
    const removeButton =
      event.target instanceof Element ? event.target.closest("[data-remove-attachment]") : null;
    if (!removeButton) {
      return;
    }
    removeComposerAttachment(String(removeButton.dataset.removeAttachment || ""));
  });
  elements.messageCutButton?.addEventListener("click", async () => {
    const input = elements.messageInput;
    if (
      state.composerCutPending ||
      !String(input?.value || "").trim()
    ) {
      return;
    }

    state.composerCutPending = true;
    updateMessageCutButton();
    announceComposerClipboardStatus("Copying draft to the clipboard.");

    let didCut = false;
    try {
      didCut = await cutComposerDraft(input);
    } catch (error) {
      announceComposerClipboardStatus("Draft was not cut. Clipboard copy failed.");
      showError(error);
    } finally {
      state.composerCutPending = false;
      updateSendAvailability();
    }

    if (!didCut) {
      return;
    }

    markCopied(composerCutKey);
    announceComposerClipboardStatus("Draft cut.");
    try {
      input.focus({ preventScroll: true });
    } catch {
      input.focus();
    }
    input.setSelectionRange(0, 0);
  });
  elements.messageCopyButton?.addEventListener("click", async () => {
    const text = String(elements.messageInput?.value || "");
    if (!text.trim()) {
      return;
    }
    try {
      await copyText(text);
      markCopied(composerCopyKey);
      updateMessageCopyButton();
    } catch (error) {
      showError(error);
    }
  });
  elements.messageInput?.addEventListener("input", updateSendAvailability);
  elements.messageInput?.addEventListener("paste", (event) => {
    const files = [...(event.clipboardData?.files || [])];
    if (files.length > 0) {
      addComposerFiles(files);
    }
  });
  elements.messageInput?.addEventListener("drop", (event) => {
    const files = [...(event.dataTransfer?.files || [])];
    if (files.length === 0) {
      return;
    }
    event.preventDefault();
    addComposerFiles(files);
  });
  elements.messageInput?.addEventListener("dragover", (event) => {
    if ((event.dataTransfer?.types || []).includes("Files")) {
      event.preventDefault();
    }
  });
  elements.quickPromptBackdrop?.addEventListener("click", closeQuickPromptModal);
  elements.quickPromptClose?.addEventListener("click", closeQuickPromptModal);
  elements.quickPromptNewButton?.addEventListener("click", openQuickPromptCreate);
  elements.quickPromptCancelButton?.addEventListener("click", () => {
    closeQuickPromptEditor();
    renderAll();
  });
  elements.quickPromptResetButton?.addEventListener("click", () => {
    if (!state.quickPromptResetConfirm) {
      closeQuickPromptEditor();
      state.quickPromptResetConfirm = true;
      state.quickPromptError = "";
      renderAll();
      return;
    }
    void saveQuickPrompts([], { reset: true });
  });
  elements.quickPromptList?.addEventListener("click", (event) => {
    const insertButton =
      event.target instanceof Element ? event.target.closest("[data-quick-prompt-insert]") : null;
    const editButton =
      event.target instanceof Element ? event.target.closest("[data-quick-prompt-edit]") : null;
    if (editButton) {
      openQuickPromptEdit(String(editButton.dataset.quickPromptEdit || ""));
      return;
    }
    if (insertButton) {
      insertQuickPrompt(String(insertButton.dataset.quickPromptInsert || ""));
    }
  });
  elements.quickPromptSaveButton?.addEventListener("click", (event) => {
    event.preventDefault();
    saveQuickPromptDraft();
  });
  elements.quickPromptForm?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || (!event.metaKey && !event.ctrlKey)) {
      return;
    }
    event.preventDefault();
    saveQuickPromptDraft();
  });
  elements.quickPromptTitleInput?.addEventListener("input", (event) => {
    state.quickPromptDraftTitle = String(event.target.value || "");
    state.quickPromptError = "";
    state.quickPromptResetConfirm = false;
    renderAll();
  });
  elements.quickPromptTextInput?.addEventListener("input", (event) => {
    state.quickPromptDraftText = String(event.target.value || "");
    state.quickPromptError = "";
    state.quickPromptResetConfirm = false;
    renderAll();
  });
  elements.quickPromptDeleteButton?.addEventListener("click", () => {
    if (state.quickPromptDraftMode !== "edit" || !state.quickPromptDraftId) {
      return;
    }
    const prompts = state.quickPrompts.filter((entry) => entry.id !== state.quickPromptDraftId);
    void saveQuickPrompts(prompts);
  });
  elements.projectDelegateButton?.addEventListener("click", () => {
    if (elements.projectDelegateButton.disabled || !state.selectedProject) {
      return;
    }
    void openDelegateModal(state.selectedProject, "default", { preferBriefWhenEmpty: true });
  });
  elements.projectArtifactsButton?.addEventListener("click", () => {
    void openArtifactsModal();
  });
  elements.artifactShelfOpenButton?.addEventListener("click", () => {
    const url = elements.artifactShelfOpenButton.dataset.dumpyUrl || "";
    if (url) {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  });
  elements.artifactShelfToggle?.addEventListener("click", () => {
    state.artifactShelfCollapsed = !state.artifactShelfCollapsed;
    persistArtifactShelfCollapsed();
    renderAll();
  });
  elements.sessionImportButton?.addEventListener("click", () => {
    void openSessionImportModal();
  });
  elements.sessionAddButton?.addEventListener("click", () => {
    void handleSessionCreate().catch(showError);
  });
  elements.sessionRenameButton.addEventListener("click", () => {
    openSessionTitleModal();
  });
  elements.dispatchForm.addEventListener("submit", handleDispatch);
  elements.detailBackdrop.addEventListener("click", closeSessionThread);
  elements.detailClose.addEventListener("click", closeSessionThread);
  elements.threadScopeProjectButton?.addEventListener("click", () => setThreadScope("project"));
  elements.threadScopeAllButton?.addEventListener("click", () => setThreadScope("all"));
  elements.threadPreviewRefreshButton?.addEventListener("click", () => {
    state.threadPreviewError = "";
    void refreshProjects()
      .then(() => state.threadScope === "project"
        ? refreshRecentHistory({ force: true, project: state.selectedProject })
        : refreshRecentHistory({ force: true }))
      .catch((error) => {
        state.threadPreviewError = error.message || "Threads could not refresh.";
        renderAll();
      });
  });
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
  elements.activeRunsBackdrop.addEventListener("click", closeActiveRunsModal);
  elements.activeRunsClose.addEventListener("click", closeActiveRunsModal);
  elements.activeRunsList.addEventListener("click", (event) => {
    const actionButton =
      event.target instanceof Element ? event.target.closest("[data-delegate-action]") : null;
    const button =
      event.target instanceof Element ? event.target.closest("[data-project-path]") : null;
    const projectPath = String(button?.dataset?.projectPath || "").trim();
    const laneId = String(button?.dataset?.laneId || "default").trim();
    if (!projectPath) {
      return;
    }
    if (actionButton?.dataset?.delegateAction === "pause") {
      event.preventDefault();
      void requestDelegateLanePause(projectPath, laneId);
      return;
    }
    void openDelegateModal(projectPath, laneId);
  });
  elements.selectedProjectDelegateList?.addEventListener("click", (event) => {
    const actionButton =
      event.target instanceof Element ? event.target.closest("[data-delegate-action]") : null;
    const button =
      event.target instanceof Element ? event.target.closest("[data-project-path]") : null;
    const projectPath = String(button?.dataset?.projectPath || "").trim();
    const laneId = String(button?.dataset?.laneId || "default").trim();
    if (!projectPath) {
      return;
    }
    if (actionButton?.dataset?.delegateAction === "pause") {
      event.preventDefault();
      void requestDelegateLanePause(projectPath, laneId);
      return;
    }
    void openDelegateModal(projectPath, laneId);
  });
  elements.activeRunsInlineList?.addEventListener("click", (event) => {
    const actionButton =
      event.target instanceof Element ? event.target.closest("[data-delegate-action]") : null;
    const button =
      event.target instanceof Element ? event.target.closest("[data-project-path]") : null;
    const projectPath = String(button?.dataset?.projectPath || "").trim();
    const laneId = String(button?.dataset?.laneId || "default").trim();
    if (!projectPath) {
      return;
    }
    if (actionButton?.dataset?.delegateAction === "pause") {
      event.preventDefault();
      void requestDelegateLanePause(projectPath, laneId);
      return;
    }
    void openDelegateModal(projectPath, laneId);
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
    void toggleDelegateSupervisor();
  });
  elements.delegateOverview?.addEventListener("click", (event) => {
    const button =
      event.target instanceof Element ? event.target.closest("[data-delegate-supervise-action]") : null;
    const action = String(button?.dataset?.delegateSuperviseAction || "").trim();
    if (!action) {
      return;
    }
    event.preventDefault();
    void requestDelegateSupervisor(action);
  });
  elements.delegateRunLogPanel?.addEventListener("click", (event) => {
    const button =
      event.target instanceof Element ? event.target.closest("[data-delegate-supervise-action]") : null;
    const action = String(button?.dataset?.delegateSuperviseAction || "").trim();
    if (!action) {
      return;
    }
    event.preventDefault();
    void requestDelegateSupervisor(action);
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
    if (button.dataset.delegateSlide === "details") {
      const project = currentDelegateProject();
      if (project?.path) {
        void loadDelegateFeed(project.path, { force: true, laneId: currentDelegateLaneId() });
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
      setDelegateLogMode(project.path, button.dataset.delegateLogMode, currentDelegateLaneId());
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
  elements.settingsButton?.addEventListener("click", openSettingsModal);
  elements.settingsBackdrop?.addEventListener("click", () => closeSettingsModal());
  elements.settingsClose?.addEventListener("click", () => closeSettingsModal());
  elements.settingsCancelButton?.addEventListener("click", () => closeSettingsModal());
  elements.settingsScratchpadInput?.addEventListener("input", (event) => {
    state.settingsWorkspaceFocusDraft = String(event.target.value || "");
    state.settingsWorkspaceStatus = "";
    renderAll();
  });
  elements.settingsScratchpadChooseButton?.addEventListener("click", () => {
    void chooseWorkspaceDirectory({
      purpose: "scratchpad",
      defaultPath: state.settingsWorkspaceFocusDraft || state.workspace?.primaryRoot || "",
    });
  });
  elements.settingsNewRootInput?.addEventListener("input", (event) => {
    state.settingsWorkspaceNewRootDraft = String(event.target.value || "");
    state.settingsWorkspaceStatus = "";
    renderAll();
  });
  elements.settingsNewRootInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addSettingsWorkspaceRoot();
    }
  });
  elements.settingsChooseRootButton?.addEventListener("click", () => {
    void chooseWorkspaceDirectory({
      purpose: "project-root",
      defaultPath:
        state.settingsWorkspaceNewRootDraft ||
        state.settingsWorkspaceFocusDraft ||
        state.workspace?.primaryRoot ||
        "",
    });
  });
  elements.settingsAddRootButton?.addEventListener("click", addSettingsWorkspaceRoot);
  elements.settingsVoiceInputSelect?.addEventListener("change", (event) => {
    state.voiceInputDeviceId = normalizeVoiceInputDeviceId(event.target.value);
    state.voiceSettingsStatus = state.voiceInputDeviceId
      ? `Using ${voiceInputDeviceLabel(state.voiceInputDeviceId)}.`
      : "Using system default microphone.";
    persistVoiceInputDevice();
    renderAll();
  });
  elements.settingsRefreshVoiceDevicesButton?.addEventListener("click", () => {
    void refreshVoiceInputDevices({ requestPermission: true });
  });
  elements.settingsOpenSetupButton?.addEventListener("click", () => {
    void openSystemSetupAssistant();
  });
  elements.systemSetupBackButton?.addEventListener("click", () => {
    goBackSystemSetup();
  });
  for (const button of elements.systemSetupRoleButtons) {
    button.addEventListener("click", () => {
      void selectSystemSetupRole(String(button.dataset.systemRole || ""));
    });
  }
  elements.systemSetupInstallCodexButton?.addEventListener("click", () => {
    void startSystemSetupCodexInstall();
  });
  elements.systemSetupLoginCodexButton?.addEventListener("click", () => {
    void openSystemSetupCodexLogin();
  });
  elements.systemSetupRefreshButton?.addEventListener("click", () => {
    void refreshSystemReadiness({ forceCodexUpdateCheck: true });
  });
  elements.systemSetupWorkspaceInput?.addEventListener("input", (event) => {
    state.systemSetupWorkspaceDraft = String(event.target.value || "");
    state.systemSetupStatus = "";
    renderAll();
  });
  elements.systemSetupWorkspaceChooseButton?.addEventListener("click", () => {
    void chooseSystemSetupWorkspace();
  });
  elements.systemSetupNextButton?.addEventListener("click", () => {
    void advanceSystemSetup();
  });
  elements.settingsCheckUpdatesButton?.addEventListener("click", () => {
    void checkDesktopAppUpdates();
  });
  elements.settingsOpenLogsButton?.addEventListener("click", () => {
    void openDesktopAppLogs();
  });
  elements.settingsCopyDiagnosticsButton?.addEventListener("click", () => {
    void copyDesktopAppDiagnostics();
  });
  elements.settingsRemoteAssistToggle?.addEventListener("change", (event) => {
    void setRemoteAssistEnabled(Boolean(event.target.checked));
  });
  elements.settingsRemoteAssistInfoButton?.addEventListener("click", () => {
    setRemoteAssistInfoOpen(!state.remoteAssistInfoOpen);
  });
  elements.settingsRemoteAssistScreenButton?.addEventListener("click", () => {
    void openRemoteAssistPrivacy("screen");
  });
  elements.settingsRemoteAssistControlButton?.addEventListener("click", () => {
    void openRemoteAssistPrivacy("accessibility");
  });
  elements.settingsRemoteAssistStopButton?.addEventListener("click", () => {
    void stopRemoteAssist();
  });
  elements.settingsPairIphoneButton?.addEventListener("click", () => {
    void startCloudPairing();
  });
  elements.settingsCopyPairingCodeButton?.addEventListener("click", () => {
    void copyCloudPairingCode();
  });
  elements.settingsRefreshDevicesButton?.addEventListener("click", () => {
    void refreshCloudDevices();
  });
  elements.settingsPairRemoteComputerButton?.addEventListener("click", () => {
    state.remotePairingOpen = true;
    state.remoteComputersStatus = "";
    renderAll();
    window.requestAnimationFrame(() => elements.settingsRemotePairingCode?.focus());
  });
  elements.settingsRemotePairingCode?.addEventListener("input", (event) => {
    state.remotePairingCode = String(event.target.value || "");
    state.remoteComputersStatus = "";
    renderAll();
  });
  elements.settingsRemotePairingCancel?.addEventListener("click", () => {
    state.remotePairingOpen = false;
    state.remotePairingCode = "";
    state.remoteComputersStatus = "";
    renderAll();
    elements.settingsPairRemoteComputerButton?.focus();
  });
  elements.settingsRemotePairingSubmit?.addEventListener("click", () => {
    void pairRemoteComputer();
  });
  elements.settingsForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    void saveWorkspaceSettings();
  });
  elements.directoryBrowserBackdrop?.addEventListener("click", () => closeDirectoryBrowser());
  elements.directoryBrowserClose?.addEventListener("click", () => closeDirectoryBrowser());
  elements.directoryBrowserCancelButton?.addEventListener("click", () => closeDirectoryBrowser());
  elements.directoryBrowserUseButton?.addEventListener("click", useDirectoryBrowserFolder);
  elements.directoryBrowserUpButton?.addEventListener("click", () => {
    if (state.directoryBrowserParent) {
      void loadDirectoryBrowserPath(state.directoryBrowserParent);
    }
  });
  elements.directoryBrowserGoButton?.addEventListener("click", () => {
    void loadDirectoryBrowserPath(state.directoryBrowserPathDraft);
  });
  elements.directoryBrowserPathInput?.addEventListener("input", (event) => {
    state.directoryBrowserPathDraft = String(event.target.value || "");
    state.directoryBrowserStatus = "";
    renderAll();
  });
  elements.directoryBrowserPathInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void loadDirectoryBrowserPath(state.directoryBrowserPathDraft);
    }
  });
  elements.directoryBrowserSearchInput?.addEventListener("input", (event) => {
    state.directoryBrowserQuery = String(event.target.value || "");
    renderAll();
  });
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
  elements.queueArchiveBackdrop?.addEventListener("click", closeQueueArchiveConfirm);
  elements.queueArchiveClose?.addEventListener("click", closeQueueArchiveConfirm);
  elements.queueArchiveCancelButton?.addEventListener("click", closeQueueArchiveConfirm);
  elements.queueArchiveConfirmButton?.addEventListener("click", archiveQueueEntry);
  elements.terminalPanelBack?.addEventListener("click", () => {
    closeTerminalStreamPanel();
  });
  elements.terminalPanelOpenExternal?.addEventListener("click", () => {
    void openSessionInTerminal({
      projectPath: state.terminalPanel.projectPath,
      sessionId: state.terminalPanel.sessionId,
    });
  });
  elements.terminalStreamList?.addEventListener("scroll", () => {
    terminalPanelStickToBottom = terminalPanelNearBottom();
  });
  elements.detailScrollBottomButton?.addEventListener("click", () => {
    scrollDetailHistoryToBottom({ smooth: true });
  });
  elements.detailHistoryList.addEventListener("scroll", async () => {
    updateDetailScrollBottomButton();
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

  elements.workspaceRootInput?.addEventListener("input", (event) => {
    state.workspaceSetupDraft = event.target.value;
    state.workspaceSetupStatus = "";
    renderAll();
  });
  elements.workspaceRootInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void saveWorkspaceSetup();
    }
  });
  elements.workspaceRootChooseButton?.addEventListener("click", () => {
    void chooseWorkspaceDirectory({
      purpose: "setup",
      defaultPath: state.workspaceSetupDraft || state.workspace?.suggestions?.[0] || "",
    });
  });
  elements.workspaceSetupSaveButton?.addEventListener("click", () => {
    void saveWorkspaceSetup();
  });

  elements.projectSelect.addEventListener("change", async (event) => {
    await selectProjectPath(event.target.value);
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
  window.addEventListener("popstate", () => {
    if (!terminalPanelHistoryActive) {
      return;
    }
    terminalPanelHistoryActive = false;
    if (terminalPanelIsOpen()) {
      closeTerminalStreamPanel({ fromHistory: true });
    }
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && goBackOneStep()) {
      event.preventDefault();
    }
  });
}

async function boot() {
  bindEvents();
  void initHeaderCarousel();
  resetProcessingPhraseCycle();
  restoreThreadEntries();
  hydrateReturnedThreadEntries();
  restoreThreadScope();
  restoreQueueCollapsed();
  restoreArtifactShelfCollapsed();
  restoreComposerAccessMode();
  restoreVoiceInputDevice();
  restoreCachedProjects();
  renderAll();
  void refreshTtsStatus({ quiet: true });
  void refreshDesktopAppStatus({ quiet: true });
  await refreshSystemReadiness({ quiet: true });

  if (!systemSetupIsOpen()) {
    try {
      await refreshProjects();
    } catch (error) {
      showError(error);
    }
  }

  window.setInterval(async () => {
    if (systemSetupIsOpen()) {
      return;
    }
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
    if (systemSetupIsOpen()) {
      return;
    }
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

function showBootFailure(error) {
  console.error("[clawdad] boot failed", error);
  const message = document.createElement("main");
  message.className = "app-shell boot-failure";
  message.innerHTML = `
    <section class="boot-failure-panel">
      <h1>Clawdad needs a refresh.</h1>
      <p>The app shell did not finish loading after the latest local update.</p>
      <button type="button">Reload</button>
    </section>
  `;
  message.querySelector("button")?.addEventListener("click", () => {
    window.location.reload();
  });
  document.body.replaceChildren(message);
}

boot().catch(showBootFailure);
