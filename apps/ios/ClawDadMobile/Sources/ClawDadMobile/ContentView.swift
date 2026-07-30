import SwiftUI
import PhotosUI
import ImageIO
import UniformTypeIdentifiers
import AVFoundation
#if canImport(UIKit)
import UIKit
#endif

struct ContentView: View {
  @EnvironmentObject private var session: CloudSession
  @EnvironmentObject private var subscription: SubscriptionManager
  @Environment(\.scenePhase) private var scenePhase
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var showingSettings = false
  @State private var showingScanner = false
  @State private var showingRemoteAssist = false
  @State private var showingTools = false
  @State private var showingProjectPicker = false
  @State private var showingNewThreadPrompt = false
  @State private var newThreadName = ""
  @State private var projectPickerSnapshot: [ProjectSummary] = []
  @State private var dispatchMode = ClawDadDispatchMode.direct
  @State private var accessMode = ClawDadAccessMode.repo
  @State private var scannerError = ""
  @State private var message = ""
  @State private var composerCopied = false
  @State private var voicePulse = false
  @State private var voiceDraftBase = ""
  @State private var consumedVoiceTranscriptionId = ""
  @State private var imageAttachments: [MobileImageAttachment] = []
  @State private var selectedThreadSelection: MobileThreadSelection?
  @StateObject private var voiceRecorder = ComposerVoiceRecorder()
  @StateObject private var remoteAssist = RemoteAssistController()
  @AppStorage("clawdad.threadScope") private var threadScopeRaw = MobileThreadScope.project.rawValue
  @FocusState private var messageEditorFocused: Bool

  private var selectedProject: ProjectSummary? {
    session.workspace.projects.first { $0.path == session.selectedProjectPath }
  }

  private var selectedThreadSummary: MobileThreadSummary? {
    selectedProject?.sessions.first {
      $0.sessionId == session.selectedSessionId
    }
  }

  private var destinationSummary: String {
    guard let selectedProject else {
      return "No project selected"
    }
    if session.selectedSessionId.isEmpty {
      return "\(selectedProject.name) - new Codex session"
    }
    return selectedProject.name
  }

  private var threadTitle: String {
    guard session.paired else {
      return "Scan Pair iPhone from your Mac"
    }
    if let selectedThreadSummary {
      return selectedThreadSummary.title
    }
    if let selectedProject, !selectedProject.activeSessionId.isEmpty {
      return "\(selectedProject.name) Chat"
    }
    return "Start new Codex session"
  }

  private var threadSubtitle: String {
    guard session.paired else {
      return "Settings on your Mac creates the QR"
    }
    guard session.connected else {
      return "Thread loads after project sync"
    }
    if let selectedThreadSummary {
      return "\(threadTimestampText(selectedThreadSummary)) - \(selectedThreadSummary.provider)"
    }
    guard !session.selectedSessionId.isEmpty else {
      return "codex"
    }
    return "codex"
  }

  private var projectTitle: String {
    selectedProject?.name ?? "Scratchpad"
  }

  private var projectSubtitle: String {
    if !session.paired {
      return "Pair this iPhone with your Mac"
    }
    if let selectedProject {
      return selectedProject.path
    }
    return session.connected ? "Choose a project" : "Projects load automatically"
  }

  private var startupStatusText: String {
    if !session.connected {
      return "Connecting to ClawDad..."
    }
    if !session.hostOnline {
      return "Finding your Mac..."
    }
    return "Loading your workspace..."
  }

  private var threadCards: [MobileThreadSummary] {
    guard let selectedProject else {
      return []
    }
    return mobileThreadsByRecentActivity(selectedProject.sessions)
  }

  private var threadScope: MobileThreadScope {
    MobileThreadScope(rawValue: threadScopeRaw) ?? .project
  }

  private var allThreadCards: [MobileThreadSummary] {
    if session.workspace.recentThreads.isEmpty {
      return mobileRecentThreads(in: session.workspace.projects)
    }
    return Array(
      mobileThreadsByRecentActivity(session.workspace.recentThreads)
        .prefix(20)
    )
  }

  private var threadPreviewCards: [MobileThreadSummary] {
    threadScope == .all ? allThreadCards : threadCards
  }

  private var visibleThreadPreviewCards: [MobileThreadSummary] {
    Array(threadPreviewCards.prefix(20))
  }

  private var threadPanelSubtitle: String {
    threadScope == .all ? "Recent across all projects" : destinationSummary
  }

  private var canSendMessage: Bool {
    subscription.hasAccess &&
      session.ready &&
      !session.selectedProjectPath.isEmpty &&
      (!message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !imageAttachments.isEmpty)
  }

  var body: some View {
    NavigationStack {
      ZStack {
        ClawDadTheme.background
          .ignoresSafeArea()

        if subscription.loading {
          subscriptionLoadingView
            .transition(.opacity)
        } else if subscription.requiresPurchase {
          subscriptionGateView
            .transition(.opacity)
        } else if session.startupLoading {
          startupLoadingView
            .transition(.opacity)
        } else {
          workspaceSurface
            .transition(.opacity)
        }

        settingsOverlay
      }
      .animation(reduceMotion ? nil : .easeInOut(duration: 0.38), value: session.startupLoading)
      .clawDadNavigationHidden()
      .sheet(isPresented: $showingSettings) {
        SettingsView(openScanner: {
          showingSettings = false
          showingScanner = true
        })
        .environmentObject(session)
        .environmentObject(subscription)
      }
      .sheet(isPresented: $showingTools) {
        ClawToolsSheet(
          dispatchMode: $dispatchMode,
          accessMode: $accessMode,
          imageAttachments: $imageAttachments
        )
        .environmentObject(session)
        .presentationDetents([.large])
      }
      .sheet(isPresented: $showingProjectPicker) {
        ProjectPickerSheet(
          projects: projectPickerSnapshot,
          selectedPath: session.selectedProjectPath,
          onSelect: { project in
            session.selectProject(project)
          }
        )
        .presentationDetents([.large])
      }
      .sheet(item: $selectedThreadSelection) { selection in
        let thread = resolveMobileThreadSelection(
          selection,
          workspace: session.workspace,
          selectedProjectPath: session.selectedProjectPath,
          selectedSessionId: session.selectedSessionId
        )
        ThreadDetailSheet(
          thread: thread,
          destinationSummary: destinationSummary,
          items: session.historyItems,
          statusText: session.historyStatus,
          onRefresh: {
            session.selectThread(thread, historyLimit: 50)
          }
        )
        .presentationDetents([.large])
      }
      .clawDadScannerCover(isPresented: $showingScanner) {
        ScannerScreen(
          onClose: { showingScanner = false },
          onCode: { code in
            showingScanner = false
            session.pairWithScannedCode(code)
          },
          onError: { error in
            showingScanner = false
            scannerError = error
          }
        )
      }
      .clawDadRemoteAssistCover(isPresented: $showingRemoteAssist) {
        RemoteAssistView(controller: remoteAssist) {
          showingRemoteAssist = false
        }
      }
      .alert("QR Scan", isPresented: Binding(
        get: { !scannerError.isEmpty },
        set: { if !$0 { scannerError = "" } }
      )) {
        Button("OK", role: .cancel) {
          scannerError = ""
        }
      } message: {
        Text(scannerError)
      }
      .alert("Start New Thread", isPresented: $showingNewThreadPrompt) {
        TextField("Optional thread name", text: $newThreadName)
          .accessibilityIdentifier("clawdad.new-thread.name")
        Button("Cancel", role: .cancel) {
          newThreadName = ""
        }
        Button("Start Thread") {
          createNewThread()
        }
      } message: {
        Text("Add a name to make this thread easier to find, or leave it blank.")
      }
      .onAppear {
        remoteAssist.bind(to: session)
        session.connectIfPaired()
      }
      .onChange(of: scenePhase) { _, phase in
        if phase == .active {
          session.connectIfPaired()
        }
      }
      .onChange(of: voiceRecorder.state) { _, nextState in
        voicePulse = false
        if nextState == .recording {
          withAnimation(.easeOut(duration: 1).repeatForever(autoreverses: false)) {
            voicePulse = true
          }
        }
      }
      .onChange(of: session.voiceTranscription) { _, transcription in
        appendVoiceTranscription(transcription)
      }
    }
  }

  private var workspaceSurface: some View {
    ScrollView {
      VStack(spacing: 16) {
        brandHeader
        composerPanel
        if !session.pendingApprovals.isEmpty {
          approvalPanel
        }
        threadPreviewPanel
      }
      .padding(.horizontal, 18)
      .padding(.top, 22)
      .padding(.bottom, 32)
      .contentShape(Rectangle())
      .onTapGesture {
        dismissKeyboard()
      }
    }
    .scrollDismissesKeyboard(.interactively)
    .accessibilityIdentifier("clawdad.workspace.ready")
  }

  private var startupLoadingView: some View {
    VStack(spacing: 22) {
      Image("ClawDadMascot")
        .resizable()
        .scaledToFit()
        .frame(width: 130, height: 195)
        .shadow(color: .black.opacity(0.42), radius: 20, y: 12)

      Image("ClawDadWordmark")
        .resizable()
        .scaledToFit()
        .frame(width: 230, height: 154)
        .shadow(color: .black.opacity(0.34), radius: 14, y: 8)

      ProgressView()
        .controlSize(.large)
        .tint(ClawDadTheme.gold)

      Text(startupStatusText)
        .font(.caption.monospaced().weight(.semibold))
        .foregroundStyle(ClawDadTheme.peach.opacity(0.82))
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .padding(.horizontal, 32)
    .accessibilityElement(children: .combine)
    .accessibilityIdentifier("clawdad.startup.loading")
  }

  private var subscriptionLoadingView: some View {
    VStack(spacing: 20) {
      Image("ClawDadMascot")
        .resizable()
        .scaledToFit()
        .frame(width: 122, height: 184)

      ProgressView()
        .controlSize(.large)
        .tint(ClawDadTheme.gold)

      Text("Checking your ClawDad access...")
        .font(.caption.monospaced().weight(.semibold))
        .foregroundStyle(ClawDadTheme.peach.opacity(0.82))
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .padding(32)
  }

  private var subscriptionGateView: some View {
    ScrollView {
      VStack(spacing: 20) {
        HStack(alignment: .bottom, spacing: 10) {
          Image("ClawDadWordmark")
            .resizable()
            .scaledToFit()
            .frame(width: 190, height: 126)
          Image("ClawDadMascot")
            .resizable()
            .scaledToFit()
            .frame(width: 84, height: 126)
        }

        VStack(spacing: 8) {
          Text("Your Codex workspace, wherever you are")
            .font(.title2.weight(.black))
            .multilineTextAlignment(.center)
            .foregroundStyle(ClawDadTheme.cream)
          Text("Every plan begins with a 14-day free trial.")
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(ClawDadTheme.peach.opacity(0.84))
        }

        VStack(spacing: 10) {
          ForEach(SubscriptionManager.plans) { plan in
            let product = subscription.product(for: plan.productId)
            Button {
              if let product {
                Task {
                  await subscription.purchase(product)
                }
              }
            } label: {
              HStack {
                VStack(alignment: .leading, spacing: 3) {
                  Text(plan.title)
                    .font(.headline.weight(.black))
                  Text("\(product?.displayPrice ?? plan.fallbackPrice) \(plan.periodLabel)")
                    .font(.caption.weight(.semibold))
                    .opacity(0.78)
                }
                Spacer()
                Image(systemName: "arrow.right")
                  .font(.headline.weight(.black))
              }
              .foregroundStyle(ClawDadTheme.cream)
              .padding(.horizontal, 16)
              .frame(minHeight: 64)
              .background(ClawDadTheme.panel)
              .overlay {
                RoundedRectangle(cornerRadius: 8)
                  .stroke(ClawDadTheme.gold.opacity(0.52), lineWidth: 1)
              }
            }
            .buttonStyle(.plain)
            .disabled(subscription.purchasePending || product == nil)
            .accessibilityIdentifier("clawdad.subscription.\(plan.title.lowercased())")
          }

          if subscription.products.isEmpty {
            Button("Try Again") {
              Task {
                await subscription.refresh()
              }
            }
            .buttonStyle(ClawDadPrimaryButtonStyle())
          }
        }

        if !subscription.statusMessage.isEmpty {
          Text(subscription.statusMessage)
            .font(.caption)
            .multilineTextAlignment(.center)
            .foregroundStyle(ClawDadTheme.peach)
        }

        Button("Restore Purchases") {
          Task {
            await subscription.restore()
          }
        }
        .buttonStyle(.plain)
        .font(.subheadline.weight(.bold))
        .foregroundStyle(ClawDadTheme.cream)
        .disabled(subscription.purchasePending)

        Text("Codex or ChatGPT access is purchased separately from OpenAI.")
          .font(.caption)
          .multilineTextAlignment(.center)
          .foregroundStyle(ClawDadTheme.peach.opacity(0.68))
      }
      .padding(.horizontal, 22)
      .padding(.top, 44)
      .padding(.bottom, 36)
    }
  }

  private var settingsOverlay: some View {
    VStack {
      HStack {
        Button {
          dismissKeyboard()
          showingRemoteAssist = true
          remoteAssist.bind(to: session)
          remoteAssist.start()
        } label: {
          Image(systemName: "desktopcomputer")
            .font(.system(size: 18, weight: .bold))
            .frame(width: 44, height: 44)
        }
        .buttonStyle(ClawDadGhostButtonStyle())
        .disabled(
          subscription.loading ||
          subscription.requiresPurchase ||
          session.startupLoading
        )
        .accessibilityLabel("Open Mac with Remote Assist")

        Spacer()
        Button {
          dismissKeyboard()
          showingSettings = true
        } label: {
          Image(systemName: "gearshape.fill")
            .font(.system(size: 18, weight: .bold))
            .frame(width: 44, height: 44)
        }
        .buttonStyle(ClawDadGhostButtonStyle())
        .accessibilityLabel("Settings")
      }
      Spacer()
    }
    .padding(.horizontal, 12)
    .padding(.top, 6)
  }

  private var brandHeader: some View {
    VStack(spacing: 8) {
      HStack(alignment: .bottom, spacing: 12) {
        Image("ClawDadWordmark")
          .resizable()
          .scaledToFit()
          .frame(width: 205, height: 137)
          .shadow(color: .black.opacity(0.38), radius: 18, y: 12)

        Image("ClawDadMascot")
          .resizable()
          .scaledToFit()
          .frame(width: 96, height: 144)
          .shadow(color: .black.opacity(0.34), radius: 16, y: 10)
      }

      Text("\"Run dat crawfish cool, cher\"")
        .font(.footnote.weight(.semibold))
        .italic()
        .foregroundStyle(ClawDadTheme.cream.opacity(0.82))
    }
    .frame(maxWidth: .infinity)
    .padding(.top, 20)
  }

  private var composerPanel: some View {
    ClawDadPanel {
      VStack(alignment: .leading, spacing: 12) {
        projectSelector
        threadSelector
        messageEditor
        composerImageAttachments
        composerActions
      }
    }
  }

  private var projectSelector: some View {
    Button {
      dismissKeyboard()
      projectPickerSnapshot = session.workspace.projects
      showingProjectPicker = true
    } label: {
      SelectorRow(
        icon: "folder.fill",
        title: projectTitle,
        subtitle: projectSubtitle,
        trailing: "chevron.down"
      )
    }
    .buttonStyle(.plain)
    .disabled(!session.paired || (!session.connected && session.workspace.projects.isEmpty))
    .accessibilityLabel("Choose project")
  }

  private var threadSelector: some View {
    HStack(spacing: 10) {
      Menu {
        if threadCards.isEmpty {
          Button(selectedProject == nil ? "Choose a project first" : "No threads loaded") {}
            .disabled(true)
        } else {
          ForEach(threadCards) { thread in
            Button {
              dismissKeyboard()
              session.selectThread(thread, historyLimit: 50)
            } label: {
              Label(
                "\(threadTimestampText(thread)) - \(thread.title)",
                systemImage: thread.sessionId == session.selectedSessionId ? "checkmark" : "bubble.left.and.bubble.right"
              )
            }
          }
        }
        Divider()
        Button {
          presentNewThreadPrompt()
        } label: {
          Label(session.sessionCreatePending ? "Starting New Thread..." : "Start New Thread", systemImage: "plus")
        }
        .disabled(selectedProject == nil || !session.ready || session.sessionCreatePending)
        Divider()
        Button {
          dismissKeyboard()
          session.requestCatalog()
          session.requestHistory()
        } label: {
          Label("Refresh Threads", systemImage: "arrow.clockwise")
        }
      } label: {
        SelectorRow(
          icon: "bubble.left.and.bubble.right.fill",
          title: threadTitle,
          subtitle: threadSubtitle,
          trailing: "chevron.down"
        )
      }
      .disabled(!session.paired || (!session.connected && threadCards.isEmpty))

      Button {
        presentNewThreadPrompt()
      } label: {
        Image(systemName: session.sessionCreatePending ? "hourglass" : "plus")
          .font(.system(size: 17, weight: .black))
          .frame(width: 46, height: 46)
      }
      .buttonStyle(ClawDadIconButtonStyle())
      .disabled(selectedProject == nil || !session.ready || session.sessionCreatePending)
      .accessibilityLabel("Start new Codex thread")
    }
  }

  private var messageEditor: some View {
    ZStack(alignment: .topLeading) {
      TextEditor(text: $message)
        .scrollContentBackground(.hidden)
        .font(.body)
        .foregroundStyle(ClawDadTheme.cream)
        .frame(minHeight: 156)
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .padding(.trailing, 40)
        .focused($messageEditorFocused)
        .accessibilityIdentifier("clawdad.composer.editor")

      if message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
        Text("Message")
          .foregroundStyle(ClawDadTheme.peach.opacity(0.52))
          .padding(.horizontal, 16)
          .padding(.vertical, 17)
          .allowsHitTesting(false)
      }
    }
    .background(ClawDadTheme.darkPanel, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
    .overlay(
      RoundedRectangle(cornerRadius: 8, style: .continuous)
        .stroke(ClawDadTheme.peach.opacity(0.18), lineWidth: 1)
    )
    .overlay(alignment: .topTrailing) {
      Button {
        copyComposerDraft()
      } label: {
        Image(systemName: composerCopied ? "checkmark" : "doc.on.doc")
          .font(.system(size: 13, weight: .bold))
          .frame(width: 34, height: 34)
      }
      .buttonStyle(ClawDadIconButtonStyle())
      .disabled(message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
      .padding(10)
      .accessibilityLabel(composerCopied ? "Draft copied" : "Copy draft")
      .accessibilityIdentifier("clawdad.composer.copy")
    }
  }

  @ViewBuilder
  private var composerImageAttachments: some View {
    if !imageAttachments.isEmpty {
      ScrollView(.horizontal, showsIndicators: false) {
        HStack(spacing: 10) {
          ForEach(imageAttachments) { attachment in
            ZStack(alignment: .topTrailing) {
              MobileImageThumbnail(attachment: attachment, size: 72)
              Button {
                imageAttachments.removeAll { $0.id == attachment.id }
              } label: {
                Image(systemName: "xmark")
                  .font(.system(size: 10, weight: .black))
                  .frame(width: 24, height: 24)
              }
              .buttonStyle(.plain)
              .foregroundStyle(ClawDadTheme.cream)
              .background(ClawDadTheme.darkPanel.opacity(0.94), in: Circle())
              .overlay(Circle().stroke(ClawDadTheme.peach.opacity(0.28), lineWidth: 1))
              .offset(x: 4, y: -4)
              .accessibilityLabel("Remove \(attachment.fileName)")
            }
          }
        }
        .padding(.horizontal, 4)
        .padding(.vertical, 6)
      }
      .frame(height: 88)
    }
  }

  private var composerActions: some View {
    VStack(spacing: 8) {
      HStack(spacing: 10) {
        Button {
          dismissKeyboard()
          showingTools = true
        } label: {
          Image("ClawGlyph")
            .resizable()
            .scaledToFit()
            .frame(width: 46, height: 46)
            .overlay(alignment: .topTrailing) {
              if !imageAttachments.isEmpty {
                Text("\(imageAttachments.count)")
                  .font(.caption2.monospaced().weight(.black))
                  .foregroundStyle(ClawDadTheme.darkPanel)
                  .frame(width: 20, height: 20)
                  .background(ClawDadTheme.gold, in: Circle())
                  .offset(x: 5, y: -5)
              }
            }
        }
        .buttonStyle(ClawDadClawButtonStyle())
        .accessibilityLabel("Open composer tools")

        Button {
          let outgoingMessage = message
          dismissKeyboard()
          session.sendMessage(
            outgoingMessage,
            dispatchMode: dispatchMode.rawValue,
            permissionMode: accessMode.permissionMode,
            imageAttachments: imageAttachments
          )
          message = ""
          voiceDraftBase = ""
          imageAttachments = []
        } label: {
          Text("Send (\(dispatchMode.label))")
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(ClawDadPrimaryButtonStyle())
        .disabled(!canSendMessage)

        Button {
          toggleVoiceRecording()
        } label: {
          ZStack {
            if voiceRecorder.state == .recording {
              Circle()
                .stroke(ClawDadTheme.peach.opacity(0.72), lineWidth: 2)
                .frame(width: 38, height: 38)
                .scaleEffect(voicePulse ? 1.35 : 0.88)
                .opacity(voicePulse ? 0 : 0.9)
            }

            if session.voiceTranscriptionPending {
              ProgressView()
                .tint(ClawDadTheme.gold)
            } else {
              Image(systemName: voiceRecorder.state == .recording ? "stop.fill" : "mic.fill")
                .font(.system(size: 15, weight: .bold))
            }
          }
          .frame(width: 42, height: 42)
        }
        .buttonStyle(ClawDadVoiceButtonStyle(recording: voiceRecorder.state == .recording))
        .disabled(
          !session.ready ||
            session.voiceTranscriptionPending ||
            voiceRecorder.state == .requestingPermission
        )
        .accessibilityLabel(
          session.voiceTranscriptionPending
            ? "Transcribing voice message"
            : voiceRecorder.state == .recording
              ? "Stop recording and transcribe"
              : "Record voice message"
        )
        .accessibilityValue(voiceRecorder.state == .recording ? "Recording" : "")
        .accessibilityIdentifier("clawdad.composer.voice")
      }

      if !composerVoiceStatusText.isEmpty {
        HStack(spacing: 8) {
          if session.voiceTranscriptionPending {
            ProgressView()
              .controlSize(.small)
              .tint(ClawDadTheme.gold)
          } else {
            Image(systemName: composerVoiceStatusIsError ? "exclamationmark.circle.fill" : "waveform")
              .font(.caption.weight(.bold))
          }
          Text(composerVoiceStatusText)
            .font(.caption.monospaced().weight(.semibold))
            .lineLimit(2)
          Spacer()
        }
        .foregroundStyle(
          composerVoiceStatusIsError
            ? ClawDadTheme.peach
            : ClawDadTheme.gold
        )
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("clawdad.composer.voice-status")
        .transition(.opacity.combined(with: .move(edge: .top)))
      }

      HStack(spacing: 6) {
        Text(session.selectedModelDisplayName)
        Text("-")
        Text(reasoningEffortLabel(session.selectedReasoningEffort))
        Spacer()
      }
      .font(.caption2.monospaced().weight(.semibold))
      .foregroundStyle(ClawDadTheme.gold.opacity(0.82))
    }
  }

  private var threadPreviewPanel: some View {
    ClawDadPanel {
      VStack(alignment: .leading, spacing: 12) {
        HStack {
          VStack(alignment: .leading, spacing: 2) {
            Text("Threads")
              .font(.caption.weight(.black))
              .textCase(.uppercase)
              .foregroundStyle(ClawDadTheme.gold)
            Text(threadPanelSubtitle)
              .font(.caption.monospaced())
              .foregroundStyle(ClawDadTheme.peach.opacity(0.72))
              .lineLimit(1)
          }
          Spacer()
          Button {
            dismissKeyboard()
            session.requestCatalog()
            if threadScope == .project {
              session.requestHistory()
            }
          } label: {
            Image(systemName: "arrow.clockwise")
              .font(.system(size: 13, weight: .black))
              .frame(width: 34, height: 34)
          }
          .buttonStyle(ClawDadIconButtonStyle())
          .disabled(
            !session.ready ||
              (threadScope == .project && session.selectedSessionId.isEmpty)
          )
          .accessibilityLabel(threadScope == .all ? "Refresh all threads" : "Refresh project threads")
        }

        Picker(
          "Thread scope",
          selection: Binding(
            get: { threadScope },
            set: { threadScopeRaw = $0.rawValue }
          )
        ) {
          ForEach(MobileThreadScope.allCases) { scope in
            Text(scope.title).tag(scope)
          }
        }
        .pickerStyle(.segmented)
        .tint(ClawDadTheme.gold)
        .accessibilityIdentifier("clawdad.threads.scope")

        if visibleThreadPreviewCards.isEmpty {
          Text(
            threadScope == .all
              ? "No Codex threads in your workspace yet."
              : (session.historyStatus.isEmpty
                ? "No Codex threads in this directory yet."
                : session.historyStatus)
          )
            .font(.subheadline)
            .foregroundStyle(ClawDadTheme.peach.opacity(0.72))
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, 8)
        } else {
          LazyVStack(alignment: .leading, spacing: 10) {
            ForEach(visibleThreadPreviewCards) { thread in
              Button {
                dismissKeyboard()
                session.selectThread(thread, historyLimit: 50)
                selectedThreadSelection = MobileThreadSelection(initialThread: thread)
              } label: {
                ThreadHistoryCard(
                  thread: thread,
                  selected: thread.projectPath == session.selectedProjectPath &&
                    thread.sessionId == session.selectedSessionId
                )
              }
              .buttonStyle(.plain)
              .accessibilityLabel("Open \(thread.title)")
            }
          }
        }
      }
    }
    .contentShape(Rectangle())
    .onTapGesture {
      dismissKeyboard()
    }
  }

  private var approvalPanel: some View {
    ClawDadPanel {
      VStack(alignment: .leading, spacing: 12) {
        if let approval = session.pendingApprovals.first {
          HStack(spacing: 10) {
            Image(systemName: "hand.raised.fill")
              .font(.system(size: 18, weight: .bold))
              .foregroundStyle(ClawDadTheme.gold)
            VStack(alignment: .leading, spacing: 2) {
              Text(approval.title)
                .font(.headline.weight(.black))
                .foregroundStyle(ClawDadTheme.cream)
              Text("Codex is paused here until you decide.")
                .font(.caption.monospaced())
                .foregroundStyle(ClawDadTheme.peach.opacity(0.72))
            }
            Spacer()
          }

          if !approval.prompt.isEmpty {
            Text(approval.prompt)
              .font(.subheadline)
              .foregroundStyle(ClawDadTheme.cream.opacity(0.92))
              .fixedSize(horizontal: false, vertical: true)
          }

          ForEach(approval.questions) { question in
            VStack(alignment: .leading, spacing: 4) {
              if !question.header.isEmpty {
                Text(question.header)
                  .font(.caption.weight(.black))
                  .textCase(.uppercase)
                  .foregroundStyle(ClawDadTheme.gold)
              }
              Text(question.question)
                .font(.subheadline)
                .foregroundStyle(ClawDadTheme.cream.opacity(0.9))
              if !question.options.isEmpty {
                Text(question.options.map(\.label).joined(separator: " / "))
                  .font(.caption)
                  .foregroundStyle(ClawDadTheme.peach.opacity(0.72))
              }
            }
          }

          HStack(spacing: 10) {
            Button {
              session.decideApproval(approval, approve: false)
            } label: {
              Text("Decline")
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(ClawDadSecondaryButtonStyle())

            Button {
              session.decideApproval(approval, approve: true)
            } label: {
              Text("Approve")
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(ClawDadPrimaryButtonStyle())
          }
        }
      }
    }
    .accessibilityIdentifier("clawdad.approval.panel")
  }

  private var composerVoiceStatusText: String {
    if session.voiceTranscriptionPending {
      return session.voiceTranscriptionStatus.isEmpty
        ? "Processing voice..."
        : session.voiceTranscriptionStatus
    }
    switch voiceRecorder.state {
    case .requestingPermission:
      return "Requesting microphone access..."
    case .recording:
      return "Recording \(voiceDurationText(voiceRecorder.duration))"
    case .idle:
      return voiceRecorder.errorMessage.isEmpty
        ? session.voiceTranscriptionError
        : voiceRecorder.errorMessage
    }
  }

  private var composerVoiceStatusIsError: Bool {
    voiceRecorder.state == .idle &&
      (!voiceRecorder.errorMessage.isEmpty || !session.voiceTranscriptionError.isEmpty)
  }

  private func copyComposerDraft() {
    guard !message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
      return
    }
    copyTextToPasteboard(message)
    composerCopied = true
    Task {
      try? await Task.sleep(nanoseconds: 1_200_000_000)
      composerCopied = false
    }
  }

  private func presentNewThreadPrompt() {
    dismissKeyboard()
    newThreadName = ""
    showingNewThreadPrompt = true
  }

  private func createNewThread() {
    let title = newThreadName
    newThreadName = ""
    session.createSession(title: title)
  }

  private func toggleVoiceRecording() {
    if voiceRecorder.state == .recording {
      do {
        let recording = try voiceRecorder.stop()
        session.transcribeVoice(
          recording.data,
          fileName: recording.fileName,
          mimeType: recording.mimeType,
          duration: recording.duration
        )
      } catch {
        voiceRecorder.present(error)
      }
      return
    }
    guard voiceRecorder.state == .idle, !session.voiceTranscriptionPending else {
      return
    }
    voiceDraftBase = message.trimmingCharacters(in: .whitespacesAndNewlines)
    dismissKeyboard()
    session.voiceTranscriptionError = ""
    Task {
      await voiceRecorder.start()
    }
  }

  private func appendVoiceTranscription(_ transcription: MobileVoiceTranscription?) {
    guard let transcription,
          transcription.id != consumedVoiceTranscriptionId else {
      return
    }
    let transcript = transcription.text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !transcript.isEmpty else {
      return
    }
    consumedVoiceTranscriptionId = transcription.id
    let currentDraft = message.trimmingCharacters(in: .whitespacesAndNewlines)
    let draft = currentDraft.isEmpty ? voiceDraftBase : currentDraft
    if draft.isEmpty {
      message = transcript
    } else {
      message = draft + "\n\n" + transcript
    }
    voiceDraftBase = ""
    messageEditorFocused = true
  }

  private func dismissKeyboard() {
    messageEditorFocused = false
    #if canImport(UIKit)
    UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
    #endif
  }

}

private struct ComposerVoiceRecording {
  var data: Data
  var fileName: String
  var mimeType: String
  var duration: TimeInterval
}

private enum ComposerVoiceRecorderState: Equatable {
  case idle
  case requestingPermission
  case recording
}

@MainActor
private final class ComposerVoiceRecorder: ObservableObject {
  @Published private(set) var state = ComposerVoiceRecorderState.idle
  @Published private(set) var duration: TimeInterval = 0
  @Published private(set) var errorMessage = ""

  private var recorder: AVAudioRecorder?
  private var recordingURL: URL?
  private var durationTask: Task<Void, Never>?

  func start() async {
    guard state == .idle else {
      return
    }
    state = .requestingPermission
    errorMessage = ""
    guard await requestMicrophonePermission() else {
      state = .idle
      errorMessage = "Microphone access is off. Enable ClawDad in Settings > Privacy & Security > Microphone."
      return
    }

    do {
      #if os(iOS)
      let audioSession = AVAudioSession.sharedInstance()
      // spokenAudio is a playback mode and fails record-only sessions with OSStatus -50.
      try audioSession.setCategory(
        .record,
        mode: .default
      )
      try audioSession.setActive(true)
      #endif

      let fileURL = FileManager.default.temporaryDirectory
        .appendingPathComponent("clawdad-voice-\(UUID().uuidString.lowercased())")
        .appendingPathExtension("m4a")
      let settings: [String: Any] = [
        AVFormatIDKey: kAudioFormatMPEG4AAC,
        AVSampleRateKey: 44_100,
        AVNumberOfChannelsKey: 1,
        AVEncoderBitRateKey: 64_000,
        AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue
      ]
      let nextRecorder = try AVAudioRecorder(url: fileURL, settings: settings)
      guard nextRecorder.prepareToRecord(), nextRecorder.record() else {
        throw ComposerVoiceRecorderError.couldNotStart
      }

      recorder = nextRecorder
      recordingURL = fileURL
      duration = 0
      state = .recording
      startDurationUpdates()
    } catch {
      finishAudioSession()
      present(error)
    }
  }

  func stop() throws -> ComposerVoiceRecording {
    guard state == .recording,
          let recorder,
          let recordingURL else {
      throw ComposerVoiceRecorderError.noActiveRecording
    }
    let recordedDuration = recorder.currentTime
    recorder.stop()
    durationTask?.cancel()
    durationTask = nil
    self.recorder = nil
    self.recordingURL = nil
    duration = 0
    state = .idle
    finishAudioSession()

    defer {
      try? FileManager.default.removeItem(at: recordingURL)
    }
    guard recordedDuration >= 0.2 else {
      throw ComposerVoiceRecorderError.tooShort
    }
    let data = try Data(contentsOf: recordingURL, options: .mappedIfSafe)
    guard !data.isEmpty else {
      throw ComposerVoiceRecorderError.noAudio
    }
    return ComposerVoiceRecording(
      data: data,
      fileName: "clawdad-voice.m4a",
      mimeType: "audio/mp4",
      duration: recordedDuration
    )
  }

  func present(_ error: Error) {
    state = .idle
    errorMessage = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
  }

  private func requestMicrophonePermission() async -> Bool {
    switch AVAudioApplication.shared.recordPermission {
    case .granted:
      return true
    case .denied:
      return false
    case .undetermined:
      return await withCheckedContinuation { continuation in
        AVAudioApplication.requestRecordPermission { granted in
          continuation.resume(returning: granted)
        }
      }
    @unknown default:
      return false
    }
  }

  private func startDurationUpdates() {
    durationTask?.cancel()
    durationTask = Task { [weak self] in
      while !Task.isCancelled {
        try? await Task.sleep(nanoseconds: 200_000_000)
        guard let self, self.state == .recording else {
          return
        }
        self.duration = self.recorder?.currentTime ?? 0
      }
    }
  }

  private func finishAudioSession() {
    #if os(iOS)
    try? AVAudioSession.sharedInstance().setActive(
      false,
      options: [.notifyOthersOnDeactivation]
    )
    #endif
  }
}

private enum ComposerVoiceRecorderError: LocalizedError {
  case couldNotStart
  case noActiveRecording
  case tooShort
  case noAudio

  var errorDescription: String? {
    switch self {
    case .couldNotStart:
      return "ClawDad could not start the microphone."
    case .noActiveRecording:
      return "There is no active voice recording."
    case .tooShort:
      return "That recording was too short. Hold for a moment and try again."
    case .noAudio:
      return "The recording did not contain any audio."
    }
  }
}

struct ThreadTurnRow: View {
  var item: MobileHistoryItem

  private var responseText: String {
    item.response.trimmingCharacters(in: .whitespacesAndNewlines)
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 7) {
      HStack(spacing: 8) {
        Text("You")
          .font(.caption.weight(.black))
          .foregroundStyle(ClawDadTheme.gold)
        if !item.status.isEmpty {
          Text(item.status.uppercased())
            .font(.caption2.monospaced().weight(.bold))
            .foregroundStyle(ClawDadTheme.peach.opacity(0.7))
        }
      }
      Text(item.message)
        .font(.subheadline.weight(.semibold))
        .foregroundStyle(ClawDadTheme.cream)
        .lineLimit(4)

      HStack(spacing: 8) {
        Text("Codex")
          .font(.caption.weight(.black))
          .foregroundStyle(ClawDadTheme.good)
        if responseText.isEmpty {
          Text("WAITING")
            .font(.caption2.monospaced().weight(.bold))
            .foregroundStyle(ClawDadTheme.peach.opacity(0.7))
        }
      }
      Text(responseText.isEmpty ? "Waiting for the Mac thread to answer." : responseText)
        .font(.caption)
        .foregroundStyle(responseText.isEmpty ? ClawDadTheme.peach.opacity(0.72) : ClawDadTheme.cream.opacity(0.88))
        .lineLimit(5)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }
}

struct ThreadHistoryCard: View {
  var thread: MobileThreadSummary
  var selected: Bool

  private var detailText: String {
    if !thread.lastResponse.isEmpty {
      return "Responded \(historyDisplayTime(thread.lastResponse))"
    }
    if !thread.lastDispatch.isEmpty {
      return "Sent \(historyDisplayTime(thread.lastDispatch))"
    }
    return "Open the Codex thread"
  }

  private var statusText: String {
    if thread.status.isEmpty {
      return thread.active ? "ACTIVE" : thread.provider.uppercased()
    }
    return thread.status.uppercased()
  }

  private var sessionSuffix: String {
    thread.sessionId.isEmpty ? "" : "...\(thread.sessionId.suffix(5))"
  }

  var body: some View {
    HStack(alignment: .top, spacing: 10) {
      VStack(spacing: 5) {
        Circle()
          .fill(selected ? ClawDadTheme.gold : ClawDadTheme.good)
          .frame(width: 9, height: 9)
        Rectangle()
          .fill(ClawDadTheme.peach.opacity(0.18))
          .frame(width: 1)
      }

      VStack(alignment: .leading, spacing: 8) {
        HStack(spacing: 8) {
          Text(historyDisplayTime(thread.lastActivityAt))
            .font(.caption2.monospaced().weight(.bold))
            .foregroundStyle(ClawDadTheme.peach.opacity(0.72))
          Spacer()
          Text(statusText)
            .font(.caption2.monospaced().weight(.black))
            .foregroundStyle(selected ? ClawDadTheme.gold : ClawDadTheme.good)
        }

        Text(thread.title)
          .font(.subheadline.weight(.heavy))
          .foregroundStyle(ClawDadTheme.cream)
          .lineLimit(2)

        HStack(spacing: 6) {
          Text(thread.projectName)
            .font(.caption.weight(.bold))
            .foregroundStyle(ClawDadTheme.cream.opacity(0.86))
            .lineLimit(1)
          if !sessionSuffix.isEmpty {
            Text(sessionSuffix)
              .font(.caption.monospaced().weight(.semibold))
              .foregroundStyle(ClawDadTheme.peach.opacity(0.7))
          }
          Spacer()
        }

        Text(detailText)
          .font(.caption)
          .foregroundStyle(ClawDadTheme.peach.opacity(0.78))
          .lineLimit(1)
      }
    }
    .padding(12)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(
      LinearGradient(
        colors: [
          ClawDadTheme.darkPanel.opacity(0.98),
          ClawDadTheme.panel.opacity(0.82)
        ],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
      ),
      in: RoundedRectangle(cornerRadius: 8, style: .continuous)
    )
    .overlay(
      RoundedRectangle(cornerRadius: 8, style: .continuous)
        .stroke(selected ? ClawDadTheme.gold.opacity(0.72) : ClawDadTheme.peach.opacity(0.18), lineWidth: 1)
    )
  }
}

func threadConversationShouldAutoScroll(
  hasItems: Bool,
  hasPositionedAtLatest: Bool,
  isNearLatest: Bool
) -> Bool {
  hasItems && (!hasPositionedAtLatest || isNearLatest)
}

func threadConversationIsNearLatest(
  bottomOffset: CGFloat,
  viewportHeight: CGFloat,
  tolerance: CGFloat = 72
) -> Bool {
  guard viewportHeight > 0, bottomOffset.isFinite else {
    return true
  }
  return bottomOffset <= viewportHeight + tolerance
}

private struct ThreadConversationBottomOffsetKey: PreferenceKey {
  static let defaultValue: CGFloat = 0

  static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
    value = nextValue()
  }
}

struct ThreadDetailSheet: View {
  @Environment(\.dismiss) private var dismiss
  @State private var hasPositionedAtLatest = false
  @State private var isNearLatest = true
  @State private var latestScrollPending = false
  var thread: MobileThreadSummary
  var destinationSummary: String
  var items: [MobileHistoryItem]
  var statusText: String
  var onRefresh: () -> Void

  private var displayedItems: [MobileHistoryItem] {
    mobileHistoryItemsInConversationOrder(items)
  }

  private let bottomAnchorId = "thread-bottom-anchor"
  private let scrollCoordinateSpace = "thread-conversation-scroll"

  private var conversationRevision: [String] {
    displayedItems.map { item in
      [
        historySelectionKey(item),
        item.lifecycleStatus,
        String(item.message.count),
        String(item.response.count),
        item.answeredAt
      ].joined(separator: ":")
    }
  }

  private func scrollToLatest(_ proxy: ScrollViewProxy, animated: Bool) {
    guard !displayedItems.isEmpty, !latestScrollPending else {
      return
    }
    latestScrollPending = true
    isNearLatest = true
    DispatchQueue.main.async {
      if animated {
        withAnimation(.snappy) {
          proxy.scrollTo(bottomAnchorId, anchor: .bottom)
        }
      } else {
        proxy.scrollTo(bottomAnchorId, anchor: .bottom)
      }
      hasPositionedAtLatest = true
      DispatchQueue.main.async {
        latestScrollPending = false
      }
    }
  }

  var body: some View {
    ZStack {
      ClawDadTheme.background
        .ignoresSafeArea()

      VStack(alignment: .leading, spacing: 14) {
        HStack(alignment: .top, spacing: 12) {
          VStack(alignment: .leading, spacing: 4) {
            Text(thread.title)
              .font(.title2.weight(.heavy))
              .foregroundStyle(ClawDadTheme.cream)
            Text("\(thread.projectName) - \(thread.provider)")
              .font(.caption.monospaced())
              .foregroundStyle(ClawDadTheme.peach.opacity(0.76))
              .lineLimit(2)
          }
          Spacer()
          Button {
            onRefresh()
          } label: {
            Image(systemName: "arrow.clockwise")
              .font(.system(size: 14, weight: .black))
              .frame(width: 40, height: 40)
          }
          .buttonStyle(ClawDadIconButtonStyle())
          .accessibilityLabel("Refresh thread")
          Button {
            dismiss()
          } label: {
            Image(systemName: "xmark")
              .font(.system(size: 15, weight: .black))
              .frame(width: 40, height: 40)
          }
          .buttonStyle(ClawDadIconButtonStyle())
          .accessibilityLabel("Close thread")
        }

        if !statusText.isEmpty {
          Text(statusText)
            .font(.caption.monospaced().weight(.semibold))
            .foregroundStyle(ClawDadTheme.gold.opacity(0.86))
        }

        GeometryReader { viewport in
          ScrollViewReader { proxy in
            ZStack(alignment: .bottomTrailing) {
              ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                  if displayedItems.isEmpty {
                    Text(statusText.isEmpty ? "Loading this Codex thread..." : statusText)
                      .font(.subheadline)
                      .foregroundStyle(ClawDadTheme.peach.opacity(0.74))
                      .frame(maxWidth: .infinity, alignment: .leading)
                      .padding(.vertical, 16)
                  } else {
                    ForEach(displayedItems) { item in
                      ThreadConversationTurn(item: item)
                        .id(historySelectionKey(item))
                    }
                  }
                  Color.clear
                    .frame(height: 82)
                  Color.clear
                    .frame(height: 1)
                    .id(bottomAnchorId)
                    .background {
                      GeometryReader { geometry in
                        Color.clear.preference(
                          key: ThreadConversationBottomOffsetKey.self,
                          value: geometry.frame(in: .named(scrollCoordinateSpace)).maxY
                        )
                      }
                    }
                }
              }
              .coordinateSpace(name: scrollCoordinateSpace)
              .onPreferenceChange(ThreadConversationBottomOffsetKey.self) { bottomOffset in
                guard hasPositionedAtLatest, !latestScrollPending, !displayedItems.isEmpty else {
                  return
                }
                isNearLatest = threadConversationIsNearLatest(
                  bottomOffset: bottomOffset,
                  viewportHeight: viewport.size.height
                )
              }
              .onAppear {
                if threadConversationShouldAutoScroll(
                  hasItems: !displayedItems.isEmpty,
                  hasPositionedAtLatest: hasPositionedAtLatest,
                  isNearLatest: isNearLatest
                ) {
                  scrollToLatest(proxy, animated: false)
                }
              }
              .onChange(of: conversationRevision) { _, revision in
                guard !revision.isEmpty else {
                  hasPositionedAtLatest = false
                  isNearLatest = true
                  return
                }
                if threadConversationShouldAutoScroll(
                  hasItems: true,
                  hasPositionedAtLatest: hasPositionedAtLatest,
                  isNearLatest: isNearLatest
                ) {
                  scrollToLatest(proxy, animated: hasPositionedAtLatest)
                }
              }

              if hasPositionedAtLatest && !isNearLatest && !displayedItems.isEmpty {
                Button {
                  scrollToLatest(proxy, animated: true)
                } label: {
                  Label("Latest", systemImage: "arrow.down")
                    .font(.caption.weight(.black))
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                }
                .buttonStyle(.plain)
                .foregroundStyle(ClawDadTheme.cream)
                .background(ClawDadTheme.panel, in: Capsule())
                .overlay(
                  Capsule()
                    .stroke(ClawDadTheme.gold.opacity(0.62), lineWidth: 1)
                )
                .shadow(color: .black.opacity(0.28), radius: 12, y: 6)
                .padding(.trailing, 4)
                .padding(.bottom, 4)
                .transition(.opacity.combined(with: .scale(scale: 0.94, anchor: .bottomTrailing)))
              }
            }
            .animation(.easeInOut(duration: 0.18), value: isNearLatest)
          }
        }
      }
      .padding(18)
    }
  }
}

struct ThreadConversationTurn: View {
  var item: MobileHistoryItem

  private var responseText: String {
    item.displayResponse
  }

  private var messageText: String {
    item.message.trimmingCharacters(in: .whitespacesAndNewlines)
  }

  private var lifecycleColor: Color {
    switch item.lifecycleStatus {
    case "failed":
      return ClawDadTheme.danger
    case "queued", "working":
      return ClawDadTheme.gold
    default:
      return ClawDadTheme.good
    }
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      HStack(spacing: 8) {
        Text(historyDisplayTime(item.sentAt))
          .font(.caption2.monospaced().weight(.bold))
          .foregroundStyle(ClawDadTheme.peach.opacity(0.72))
        Spacer()
        Text(item.lifecycleLabel)
          .font(.caption2.monospaced().weight(.black))
          .foregroundStyle(lifecycleColor)
      }

      ThreadMessageBlock(
        title: "You",
        titleColor: ClawDadTheme.gold,
        displayText: messageText.isEmpty ? "Message unavailable." : item.message,
        copyText: messageText,
        foreground: ClawDadTheme.cream,
        baseFont: .body.weight(.semibold)
      )

      ThreadMessageBlock(
        title: "Codex",
        titleColor: item.lifecycleStatus == "failed" ? ClawDadTheme.danger : ClawDadTheme.good,
        displayText: responseText.isEmpty ? item.responsePlaceholder : responseText,
        copyText: responseText,
        foreground: responseText.isEmpty ? ClawDadTheme.peach.opacity(0.74) : ClawDadTheme.cream.opacity(0.92)
      )
    }
    .padding(14)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(
      ClawDadTheme.darkPanel.opacity(0.88),
      in: RoundedRectangle(cornerRadius: 8, style: .continuous)
    )
    .overlay(
      RoundedRectangle(cornerRadius: 8, style: .continuous)
        .stroke(ClawDadTheme.peach.opacity(0.16), lineWidth: 1)
    )
  }
}

struct ThreadMessageBlock: View {
  var title: String
  var titleColor: Color
  var displayText: String
  var copyText: String
  var foreground: Color
  var baseFont: Font = .body

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack(spacing: 8) {
        Text(title)
          .font(.caption.weight(.black))
          .foregroundStyle(titleColor)
        Spacer()
        MessageCopyButton(
          text: copyText,
          accessibilityLabel: "Copy \(title) message"
        )
      }

      RichMessageText(
        text: displayText,
        foreground: foreground,
        baseFont: baseFont
      )
    }
  }
}

struct MessageCopyButton: View {
  var text: String
  var accessibilityLabel: String
  @State private var copied = false

  private var canCopy: Bool {
    !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
  }

  var body: some View {
    Button {
      copyTextToPasteboard(text)
      copied = true
      DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) {
        copied = false
      }
    } label: {
      Image(systemName: copied ? "checkmark" : "doc.on.doc")
        .font(.system(size: 12, weight: .black))
        .frame(width: 30, height: 30)
    }
    .buttonStyle(.plain)
    .foregroundStyle(copied ? ClawDadTheme.good : ClawDadTheme.cream.opacity(0.88))
    .background(ClawDadTheme.darkPanel.opacity(0.88), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
    .overlay(
      RoundedRectangle(cornerRadius: 8, style: .continuous)
        .stroke((copied ? ClawDadTheme.good : ClawDadTheme.peach).opacity(0.24), lineWidth: 1)
    )
    .opacity(canCopy ? 1 : 0.48)
    .disabled(!canCopy)
    .accessibilityLabel(accessibilityLabel)
  }
}

private enum RichMessageSegment: Equatable {
  case prose(String)
  case code(String)
}

private enum RichMessageBlock: Equatable {
  case paragraph(String)
  case heading(String, Int)
  case unordered(String)
  case ordered(String, String)
  case quote(String)
  case rule
}

struct RichMessageText: View {
  var text: String
  var foreground: Color
  var baseFont: Font = .body

  private var segments: [RichMessageSegment] {
    richMessageSegments(text)
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 9) {
      ForEach(Array(segments.enumerated()), id: \.offset) { _, segment in
        switch segment {
        case .prose(let prose):
          VStack(alignment: .leading, spacing: 8) {
            ForEach(Array(richMessageBlocks(prose).enumerated()), id: \.offset) { _, block in
              RichMessageBlockView(
                block: block,
                foreground: foreground,
                baseFont: baseFont
              )
            }
          }
        case .code(let code):
          ScrollView(.horizontal, showsIndicators: false) {
            Text(code.isEmpty ? " " : code)
              .font(.system(.caption, design: .monospaced))
              .foregroundStyle(ClawDadTheme.cream)
              .textSelection(.enabled)
              .padding(10)
          }
          .frame(maxWidth: .infinity, alignment: .leading)
          .background(
            ClawDadTheme.darkPanel.opacity(0.92),
            in: RoundedRectangle(cornerRadius: 7, style: .continuous)
          )
          .overlay(
            RoundedRectangle(cornerRadius: 7, style: .continuous)
              .stroke(ClawDadTheme.peach.opacity(0.18), lineWidth: 1)
          )
        }
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }
}

private struct RichMessageBlockView: View {
  var block: RichMessageBlock
  var foreground: Color
  var baseFont: Font

  var body: some View {
    switch block {
    case .paragraph(let value):
      Text(richAttributedString(value))
        .font(baseFont)
        .foregroundStyle(foreground)
        .tint(ClawDadTheme.gold)
        .lineSpacing(4)
        .textSelection(.enabled)
        .frame(maxWidth: .infinity, alignment: .leading)
    case .heading(let value, let level):
      Text(richAttributedString(value))
        .font(headingFont(level))
        .foregroundStyle(ClawDadTheme.cream)
        .tint(ClawDadTheme.gold)
        .lineSpacing(3)
        .textSelection(.enabled)
        .frame(maxWidth: .infinity, alignment: .leading)
    case .unordered(let value):
      HStack(alignment: .top, spacing: 8) {
        Text("•")
          .font(baseFont.weight(.heavy))
          .foregroundStyle(ClawDadTheme.gold)
          .frame(width: 14, alignment: .leading)
        Text(richAttributedString(value))
          .font(baseFont)
          .foregroundStyle(foreground)
          .tint(ClawDadTheme.gold)
          .lineSpacing(4)
          .textSelection(.enabled)
          .frame(maxWidth: .infinity, alignment: .leading)
      }
    case .ordered(let marker, let value):
      HStack(alignment: .top, spacing: 8) {
        Text("\(marker).")
          .font(.caption.monospaced().weight(.black))
          .foregroundStyle(ClawDadTheme.gold)
          .frame(width: 24, alignment: .trailing)
        Text(richAttributedString(value))
          .font(baseFont)
          .foregroundStyle(foreground)
          .tint(ClawDadTheme.gold)
          .lineSpacing(4)
          .textSelection(.enabled)
          .frame(maxWidth: .infinity, alignment: .leading)
      }
    case .quote(let value):
      HStack(alignment: .top, spacing: 10) {
        Rectangle()
          .fill(ClawDadTheme.gold.opacity(0.72))
          .frame(width: 3)
          .clipShape(Capsule())
        Text(richAttributedString(value))
          .font(baseFont)
          .italic()
          .foregroundStyle(foreground.opacity(0.9))
          .tint(ClawDadTheme.gold)
          .lineSpacing(4)
          .textSelection(.enabled)
          .frame(maxWidth: .infinity, alignment: .leading)
      }
      .padding(.vertical, 3)
    case .rule:
      Rectangle()
        .fill(ClawDadTheme.peach.opacity(0.18))
        .frame(height: 1)
        .padding(.vertical, 4)
    }
  }
}

private func historySelectionKey(_ item: MobileHistoryItem) -> String {
  item.requestId.isEmpty ? item.id : item.requestId
}

func mobileHistoryItemsInConversationOrder(
  _ items: [MobileHistoryItem]
) -> [MobileHistoryItem] {
  items.sorted { left, right in
    let leftTime = historyItemConversationMs(left)
    let rightTime = historyItemConversationMs(right)
    if leftTime != rightTime {
      return leftTime < rightTime
    }
    return historySelectionKey(left) < historySelectionKey(right)
  }
}

private func historyItemConversationMs(_ item: MobileHistoryItem) -> TimeInterval {
  if let sentAt = parseCloudTimestamp(item.sentAt) {
    return sentAt.timeIntervalSince1970
  }
  return parseCloudTimestamp(item.answeredAt)?.timeIntervalSince1970 ?? 0
}

private func richMessageSegments(_ text: String) -> [RichMessageSegment] {
  let parts = text.components(separatedBy: "```")
  var segments: [RichMessageSegment] = []
  for index in parts.indices {
    let part = parts[index]
    if index.isMultiple(of: 2) {
      let prose = part.trimmingCharacters(in: .whitespacesAndNewlines)
      if !prose.isEmpty {
        segments.append(.prose(prose))
      }
    } else {
      segments.append(.code(cleanCodeFence(part)))
    }
  }
  return segments.isEmpty ? [.prose(text)] : segments
}

private func cleanCodeFence(_ value: String) -> String {
  var lines = value.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
  if
    let first = lines.first?.trimmingCharacters(in: .whitespacesAndNewlines),
    lines.count > 1,
    !first.isEmpty,
    !first.contains(" "),
    first.count <= 24
  {
    lines.removeFirst()
  }
  return lines.joined(separator: "\n").trimmingCharacters(in: .newlines)
}

private func richMessageBlocks(_ value: String) -> [RichMessageBlock] {
  var blocks: [RichMessageBlock] = []
  var paragraphLines: [String] = []

  func flushParagraph() {
    let paragraph = paragraphLines
      .joined(separator: "\n")
      .trimmingCharacters(in: .whitespacesAndNewlines)
    paragraphLines.removeAll()
    if !paragraph.isEmpty {
      blocks.append(.paragraph(paragraph))
    }
  }

  for rawLine in value.replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n") {
    let trimmed = rawLine.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else {
      flushParagraph()
      continue
    }

    if let heading = richHeadingParts(trimmed) {
      flushParagraph()
      blocks.append(.heading(heading.text, heading.level))
      continue
    }

    if trimmed == "---" || trimmed == "***" || trimmed == "___" {
      flushParagraph()
      blocks.append(.rule)
      continue
    }

    if let quote = richQuoteText(trimmed) {
      flushParagraph()
      blocks.append(.quote(quote))
      continue
    }

    if let unordered = richUnorderedText(trimmed) {
      flushParagraph()
      blocks.append(.unordered(unordered))
      continue
    }

    if let ordered = richOrderedParts(trimmed) {
      flushParagraph()
      blocks.append(.ordered(ordered.marker, ordered.text))
      continue
    }

    paragraphLines.append(rawLine)
  }

  flushParagraph()
  return blocks.isEmpty ? [.paragraph(value)] : blocks
}

private func richHeadingParts(_ value: String) -> (text: String, level: Int)? {
  let level = value.prefix { $0 == "#" }.count
  guard level > 0, level <= 4 else {
    return nil
  }
  let textStart = value.index(value.startIndex, offsetBy: level)
  guard textStart < value.endIndex, value[textStart] == " " else {
    return nil
  }
  let text = value[textStart...].trimmingCharacters(in: .whitespacesAndNewlines)
  return text.isEmpty ? nil : (text, level)
}

private func richQuoteText(_ value: String) -> String? {
  guard value.hasPrefix(">") else {
    return nil
  }
  let text = value.dropFirst().trimmingCharacters(in: .whitespacesAndNewlines)
  return text.isEmpty ? nil : text
}

private func richUnorderedText(_ value: String) -> String? {
  for marker in ["- ", "* ", "• "] where value.hasPrefix(marker) {
    let text = value.dropFirst(marker.count).trimmingCharacters(in: .whitespacesAndNewlines)
    return text.isEmpty ? nil : text
  }
  return nil
}

private func richOrderedParts(_ value: String) -> (marker: String, text: String)? {
  guard let markerEnd = value.firstIndex(where: { $0 == "." || $0 == ")" }) else {
    return nil
  }
  let marker = String(value[..<markerEnd])
  guard !marker.isEmpty, marker.allSatisfy({ $0.isNumber }) else {
    return nil
  }
  let textStart = value.index(after: markerEnd)
  guard textStart < value.endIndex, value[textStart] == " " else {
    return nil
  }
  let text = value[textStart...].trimmingCharacters(in: .whitespacesAndNewlines)
  return text.isEmpty ? nil : (marker, text)
}

private func headingFont(_ level: Int) -> Font {
  switch level {
  case 1:
    return .title3.weight(.heavy)
  case 2:
    return .headline.weight(.heavy)
  default:
    return .subheadline.weight(.black)
  }
}

private func richAttributedString(_ value: String) -> AttributedString {
  let prepared = markdownAutolinkText(value)
  let options = AttributedString.MarkdownParsingOptions(
    interpretedSyntax: .inlineOnlyPreservingWhitespace
  )
  if let parsed = try? AttributedString(markdown: prepared, options: options) {
    return parsed
  }
  return AttributedString(value)
}

private func markdownAutolinkText(_ value: String) -> String {
  let pattern = #"(?<!<)(https?://[^\s<>)]+)"#
  guard let regex = try? NSRegularExpression(pattern: pattern) else {
    return value
  }
  var result = value
  let range = NSRange(value.startIndex..<value.endIndex, in: value)
  for match in regex.matches(in: value, range: range).reversed() {
    guard let matchRange = Range(match.range(at: 1), in: result) else {
      continue
    }
    let url = result[matchRange]
    result.replaceSubrange(matchRange, with: "<\(url)>")
  }
  return result
}

private func copyTextToPasteboard(_ text: String) {
  #if canImport(UIKit)
  UIPasteboard.general.string = text
  #endif
}

private func voiceDurationText(_ duration: TimeInterval) -> String {
  let seconds = max(0, Int(duration.rounded(.down)))
  return String(format: "%d:%02d", seconds / 60, seconds % 60)
}

private func threadTimestampText(_ thread: MobileThreadSummary) -> String {
  let candidates = [
    thread.lastActivityAt,
    thread.lastResponse,
    thread.lastDispatch
  ]
  .compactMap { value -> (date: Date, raw: String)? in
    guard let date = parseCloudTimestamp(value) else {
      return nil
    }
    return (date, value)
  }
  .sorted { left, right in
    left.date > right.date
  }

  guard let latest = candidates.first else {
    return "No timestamp"
  }
  return historyDisplayTime(latest.raw)
}

private func historyDisplayTime(_ value: String) -> String {
  let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
  guard !trimmed.isEmpty else {
    return "Now"
  }
  if let date = parseCloudTimestamp(trimmed) {
    let display = DateFormatter()
    display.dateStyle = .none
    display.timeStyle = .short
    return display.string(from: date)
  }
  return trimmed
}

struct ScannerScreen: View {
  var onClose: () -> Void
  var onCode: (String) -> Void
  var onError: (String) -> Void

  var body: some View {
    ZStack(alignment: .top) {
      QRScannerView(onCode: onCode, onError: onError)
        .ignoresSafeArea()

      VStack(spacing: 12) {
        HStack {
          VStack(alignment: .leading, spacing: 3) {
            Text("Pair iPhone")
              .font(.title2.weight(.heavy))
              .foregroundStyle(ClawDadTheme.cream)
            Text("Scan the QR from ClawDad Settings on your Mac")
              .font(.footnote.weight(.semibold))
              .foregroundStyle(ClawDadTheme.peach.opacity(0.84))
          }
          Spacer()
          Button {
            onClose()
          } label: {
            Image(systemName: "xmark")
              .font(.system(size: 16, weight: .black))
              .frame(width: 42, height: 42)
          }
          .buttonStyle(ClawDadIconButtonStyle())
          .accessibilityLabel("Close scanner")
        }

        RoundedRectangle(cornerRadius: 18, style: .continuous)
          .stroke(ClawDadTheme.gold.opacity(0.82), lineWidth: 3)
          .frame(width: 230, height: 230)
          .shadow(color: .black.opacity(0.4), radius: 18, y: 8)
          .padding(.top, 56)

        Spacer()
      }
      .padding(18)
      .background(
        LinearGradient(
          colors: [Color.black.opacity(0.58), Color.black.opacity(0.08), .clear],
          startPoint: .top,
          endPoint: .bottom
        )
        .ignoresSafeArea()
      )
    }
  }
}

struct SelectorRow: View {
  var icon: String
  var title: String
  var subtitle: String
  var trailing: String

  var body: some View {
    HStack(spacing: 10) {
      Image(systemName: icon)
        .font(.system(size: 16, weight: .bold))
        .foregroundStyle(ClawDadTheme.gold)
        .frame(width: 24)
      VStack(alignment: .leading, spacing: 3) {
        Text(title)
          .font(.headline.weight(.heavy))
          .foregroundStyle(ClawDadTheme.cream)
          .lineLimit(1)
        Text(subtitle)
          .font(.caption)
          .foregroundStyle(ClawDadTheme.peach.opacity(0.72))
          .lineLimit(1)
      }
      Spacer()
      Image(systemName: trailing)
        .font(.caption.weight(.black))
        .foregroundStyle(ClawDadTheme.peach.opacity(0.72))
    }
    .padding(14)
    .background(ClawDadTheme.darkPanel, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
    .overlay(
      RoundedRectangle(cornerRadius: 8, style: .continuous)
        .stroke(ClawDadTheme.peach.opacity(0.14), lineWidth: 1)
    )
  }
}

private struct ProjectPickerGroup: Identifiable {
  var id: String { directory }
  var directory: String
  var projects: [ProjectSummary]
}

struct ProjectPickerSheet: View {
  @Environment(\.dismiss) private var dismiss
  var projects: [ProjectSummary]
  var selectedPath: String
  var onSelect: (ProjectSummary) -> Void
  @State private var searchText = ""

  private var matchingProjects: [ProjectSummary] {
    let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !query.isEmpty else {
      return projects
    }
    return projects.filter { project in
      project.name.localizedCaseInsensitiveContains(query) ||
        project.path.localizedCaseInsensitiveContains(query)
    }
  }

  private var groups: [ProjectPickerGroup] {
    let grouped = Dictionary(grouping: matchingProjects) { project in
      URL(fileURLWithPath: project.path).deletingLastPathComponent().path
    }
    return grouped.map { directory, projects in
      ProjectPickerGroup(
        directory: directory,
        projects: projects.sorted {
          $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending
        }
      )
    }
    .sorted {
      $0.directory.localizedCaseInsensitiveCompare($1.directory) == .orderedAscending
    }
  }

  var body: some View {
    ZStack {
      ClawDadTheme.background
        .ignoresSafeArea()

      VStack(alignment: .leading, spacing: 14) {
        HStack(alignment: .top, spacing: 12) {
          VStack(alignment: .leading, spacing: 3) {
            Text("Projects")
              .font(.title2.weight(.heavy))
              .foregroundStyle(ClawDadTheme.cream)
            Text("\(matchingProjects.count) available")
              .font(.caption.monospaced())
              .foregroundStyle(ClawDadTheme.peach.opacity(0.74))
          }
          Spacer()
          Button {
            dismiss()
          } label: {
            Image(systemName: "xmark")
              .font(.system(size: 15, weight: .black))
              .frame(width: 40, height: 40)
          }
          .buttonStyle(ClawDadIconButtonStyle())
          .accessibilityLabel("Close project picker")
        }

        HStack(spacing: 10) {
          Image(systemName: "magnifyingglass")
            .font(.system(size: 15, weight: .bold))
            .foregroundStyle(ClawDadTheme.gold)
          #if os(iOS)
          TextField("Search projects", text: $searchText)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .foregroundStyle(ClawDadTheme.cream)
          #else
          TextField("Search projects", text: $searchText)
            .foregroundStyle(ClawDadTheme.cream)
          #endif
          if !searchText.isEmpty {
            Button {
              searchText = ""
            } label: {
              Image(systemName: "xmark.circle.fill")
                .foregroundStyle(ClawDadTheme.peach.opacity(0.72))
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Clear project search")
          }
        }
        .padding(.horizontal, 13)
        .frame(height: 46)
        .background(ClawDadTheme.darkPanel, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(
          RoundedRectangle(cornerRadius: 8, style: .continuous)
            .stroke(ClawDadTheme.peach.opacity(0.18), lineWidth: 1)
        )

        ScrollViewReader { proxy in
          ScrollView {
            LazyVStack(alignment: .leading, spacing: 16, pinnedViews: [.sectionHeaders]) {
              if groups.isEmpty {
                Text("No matching projects")
                  .font(.subheadline)
                  .foregroundStyle(ClawDadTheme.peach.opacity(0.72))
                  .frame(maxWidth: .infinity, alignment: .leading)
                  .padding(.vertical, 18)
              } else {
                ForEach(groups) { group in
                  Section {
                    VStack(spacing: 6) {
                      ForEach(group.projects) { project in
                        Button {
                          onSelect(project)
                          dismiss()
                        } label: {
                          HStack(spacing: 11) {
                            Image(systemName: "folder")
                              .font(.system(size: 15, weight: .bold))
                              .foregroundStyle(ClawDadTheme.gold)
                              .frame(width: 22)
                            Text(project.name)
                              .font(.body.weight(.semibold))
                              .foregroundStyle(ClawDadTheme.cream)
                              .lineLimit(2)
                            Spacer()
                            if project.path == selectedPath {
                              Image(systemName: "checkmark")
                                .font(.system(size: 14, weight: .black))
                                .foregroundStyle(ClawDadTheme.good)
                            }
                          }
                          .padding(.horizontal, 12)
                          .frame(minHeight: 46)
                          .background(
                            project.path == selectedPath
                              ? ClawDadTheme.panel
                              : ClawDadTheme.darkPanel.opacity(0.82),
                            in: RoundedRectangle(cornerRadius: 7, style: .continuous)
                          )
                          .overlay(
                            RoundedRectangle(cornerRadius: 7, style: .continuous)
                              .stroke(
                                project.path == selectedPath
                                  ? ClawDadTheme.gold.opacity(0.62)
                                  : ClawDadTheme.peach.opacity(0.12),
                                lineWidth: 1
                              )
                          )
                          .padding(.leading, 10)
                        }
                        .buttonStyle(.plain)
                        .id(project.path)
                      }
                    }
                  } header: {
                    Text(group.directory)
                      .font(.caption.weight(.black))
                      .foregroundStyle(ClawDadTheme.gold)
                      .lineLimit(2)
                      .frame(maxWidth: .infinity, alignment: .leading)
                      .padding(.vertical, 7)
                      .background(ClawDadTheme.background.opacity(0.96))
                  }
                }
              }
            }
            .padding(.bottom, 24)
          }
          .onAppear {
            guard searchText.isEmpty, !selectedPath.isEmpty else {
              return
            }
            DispatchQueue.main.async {
              proxy.scrollTo(selectedPath, anchor: .center)
            }
          }
        }
      }
      .padding(18)
    }
  }
}

private let mobileImageAttachmentMaxBytes = 4 * 1024 * 1024

private enum MobileImageAttachmentError: LocalizedError {
  case unreadable
  case encodingFailed
  case tooLarge

  var errorDescription: String? {
    switch self {
    case .unreadable:
      return "ClawDad could not read that image."
    case .encodingFailed:
      return "ClawDad could not prepare that image for sending."
    case .tooLarge:
      return "That image is still larger than 4 MB after resizing."
    }
  }
}

private func jpegData(for image: CGImage, quality: Double) -> Data? {
  let output = NSMutableData()
  guard let destination = CGImageDestinationCreateWithData(
    output,
    UTType.jpeg.identifier as CFString,
    1,
    nil
  ) else {
    return nil
  }
  CGImageDestinationAddImage(
    destination,
    image,
    [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary
  )
  guard CGImageDestinationFinalize(destination) else {
    return nil
  }
  return output as Data
}

private func makeMobileImageAttachment(from sourceData: Data, sequence: Int) throws -> MobileImageAttachment {
  guard
    let source = CGImageSourceCreateWithData(sourceData as CFData, nil),
    let image = CGImageSourceCreateThumbnailAtIndex(
      source,
      0,
      [
        kCGImageSourceCreateThumbnailFromImageAlways: true,
        kCGImageSourceCreateThumbnailWithTransform: true,
        kCGImageSourceThumbnailMaxPixelSize: 2048,
        kCGImageSourceShouldCacheImmediately: true
      ] as CFDictionary
    )
  else {
    throw MobileImageAttachmentError.unreadable
  }

  var encoded: Data?
  for quality in [0.88, 0.74, 0.60] {
    let candidate = jpegData(for: image, quality: quality)
    encoded = candidate
    if let candidate, candidate.count <= mobileImageAttachmentMaxBytes {
      break
    }
  }
  guard let encoded else {
    throw MobileImageAttachmentError.encodingFailed
  }
  guard encoded.count <= mobileImageAttachmentMaxBytes else {
    throw MobileImageAttachmentError.tooLarge
  }

  let shortId = UUID().uuidString.prefix(8).lowercased()
  return MobileImageAttachment(
    id: UUID(),
    fileName: "clawdad-image-\(sequence + 1)-\(shortId).jpg",
    mimeType: "image/jpeg",
    data: encoded
  )
}

private func mobileAttachmentSizeText(_ bytes: Int) -> String {
  let formatter = ByteCountFormatter()
  formatter.allowedUnits = [.useKB, .useMB]
  formatter.countStyle = .file
  return formatter.string(fromByteCount: Int64(bytes))
}

private struct MobileImageThumbnail: View {
  var attachment: MobileImageAttachment
  var size: CGFloat

  var body: some View {
    Group {
      #if canImport(UIKit)
      if let image = UIImage(data: attachment.data) {
        Image(uiImage: image)
          .resizable()
          .scaledToFill()
      } else {
        Image(systemName: "photo")
          .resizable()
          .scaledToFit()
          .padding(14)
          .foregroundStyle(ClawDadTheme.gold)
      }
      #else
      Image(systemName: "photo")
        .resizable()
        .scaledToFit()
        .padding(14)
        .foregroundStyle(ClawDadTheme.gold)
      #endif
    }
    .frame(width: size, height: size)
    .background(ClawDadTheme.darkPanel)
    .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    .overlay(
      RoundedRectangle(cornerRadius: 8, style: .continuous)
        .stroke(ClawDadTheme.peach.opacity(0.2), lineWidth: 1)
    )
    .clipped()
  }
}

struct ClawToolsSheet: View {
  @Environment(\.dismiss) private var dismiss
  @EnvironmentObject private var session: CloudSession
  @Binding var dispatchMode: ClawDadDispatchMode
  @Binding var accessMode: ClawDadAccessMode
  @Binding var imageAttachments: [MobileImageAttachment]
  @State private var selectedPhotoItems: [PhotosPickerItem] = []
  @State private var importingImages = false
  @State private var imageImportError = ""

  private let maxImageAttachments = 4

  private var remainingImageCapacity: Int {
    max(0, maxImageAttachments - imageAttachments.count)
  }

  private var modelChoices: [CodexModelSummary] {
    if !session.modelOptions.isEmpty {
      return session.modelOptions
    }
    return [
      CodexModelSummary(
        model: session.selectedModel,
        displayName: session.selectedModelDisplayName,
        description: "",
        isDefault: true,
        defaultReasoningEffort: session.selectedReasoningEffort,
        supportedReasoningEfforts: session.supportedReasoningEfforts
      )
    ]
  }

  var body: some View {
    ZStack {
      ClawDadTheme.background
        .ignoresSafeArea()

      ScrollView {
        VStack(alignment: .leading, spacing: 16) {
          HStack {
            VStack(alignment: .leading, spacing: 3) {
              Text("Claw Tools")
                .font(.title2.weight(.heavy))
                .foregroundStyle(ClawDadTheme.cream)
              Text("\(session.selectedModelDisplayName) - \(reasoningEffortLabel(session.selectedReasoningEffort))")
                .font(.caption.monospaced())
                .foregroundStyle(ClawDadTheme.peach.opacity(0.74))
            }
            Spacer()
            Button {
              dismiss()
            } label: {
              Image(systemName: "xmark")
                .font(.system(size: 15, weight: .black))
                .frame(width: 40, height: 40)
            }
            .buttonStyle(ClawDadIconButtonStyle())
            .accessibilityLabel("Close tools")
          }

          ClawDadPanel {
            VStack(alignment: .leading, spacing: 12) {
              HStack {
                Text("Images")
                  .font(.caption.weight(.black))
                  .textCase(.uppercase)
                  .foregroundStyle(ClawDadTheme.gold)
                Spacer()
                Text("\(imageAttachments.count)/\(maxImageAttachments)")
                  .font(.caption.monospaced().weight(.bold))
                  .foregroundStyle(ClawDadTheme.peach.opacity(0.72))
              }

              PhotosPicker(
                selection: $selectedPhotoItems,
                maxSelectionCount: max(1, remainingImageCapacity),
                matching: .images
              ) {
                Label("Add Images", systemImage: "photo.on.rectangle.angled")
              }
              .buttonStyle(ClawDadSecondaryButtonStyle())
              .disabled(importingImages || remainingImageCapacity == 0)

              if importingImages {
                ProgressView()
                  .tint(ClawDadTheme.gold)
                  .frame(maxWidth: .infinity)
              }

              if !imageImportError.isEmpty {
                Text(imageImportError)
                  .font(.caption)
                  .foregroundStyle(.red)
              }

              ForEach(imageAttachments) { attachment in
                Divider()
                  .overlay(ClawDadTheme.peach.opacity(0.16))
                HStack(spacing: 10) {
                  MobileImageThumbnail(attachment: attachment, size: 46)
                  VStack(alignment: .leading, spacing: 3) {
                    Text(attachment.fileName)
                      .font(.subheadline.weight(.semibold))
                      .foregroundStyle(ClawDadTheme.cream)
                      .lineLimit(1)
                    Text(mobileAttachmentSizeText(attachment.data.count))
                      .font(.caption.monospaced())
                      .foregroundStyle(ClawDadTheme.peach.opacity(0.72))
                  }
                  Spacer()
                  Button {
                    imageAttachments.removeAll { $0.id == attachment.id }
                  } label: {
                    Image(systemName: "trash")
                      .font(.system(size: 14, weight: .bold))
                      .frame(width: 36, height: 36)
                  }
                  .buttonStyle(ClawDadIconButtonStyle())
                  .accessibilityLabel("Remove \(attachment.fileName)")
                }
              }
            }
          }

          ClawDadPanel {
            VStack(alignment: .leading, spacing: 10) {
              Text("Message Mode")
                .font(.caption.weight(.black))
                .textCase(.uppercase)
                .foregroundStyle(ClawDadTheme.gold)
              HStack(spacing: 8) {
                ForEach(ClawDadDispatchMode.allCases) { mode in
                  Button {
                    dispatchMode = mode
                  } label: {
                    Text(mode.label)
                      .frame(maxWidth: .infinity)
                  }
                  .buttonStyle(ClawDadSegmentButtonStyle(selected: dispatchMode == mode))
                }
              }
            }
          }

          ClawDadPanel {
            VStack(alignment: .leading, spacing: 12) {
              Text("Model")
                .font(.caption.weight(.black))
                .textCase(.uppercase)
                .foregroundStyle(ClawDadTheme.gold)
              Menu {
                ForEach(modelChoices) { model in
                  Button {
                    session.chooseModel(model)
                  } label: {
                    Label(
                      model.displayName,
                      systemImage: model.model == session.selectedModel ? "checkmark" : "cpu"
                    )
                  }
                }
              } label: {
                HStack(spacing: 10) {
                  Image(systemName: "cpu")
                  Text(session.selectedModelDisplayName)
                    .lineLimit(1)
                  Spacer()
                  Image(systemName: "chevron.up.chevron.down")
                    .font(.caption.weight(.bold))
                }
                .foregroundStyle(ClawDadTheme.cream)
              }

              Divider()
                .overlay(ClawDadTheme.peach.opacity(0.2))

              Text("Reasoning Effort")
                .font(.caption.weight(.black))
                .textCase(.uppercase)
                .foregroundStyle(ClawDadTheme.gold)
              Menu {
                ForEach(session.supportedReasoningEfforts, id: \.self) { effort in
                  Button {
                    session.chooseReasoningEffort(effort)
                  } label: {
                    Label(
                      reasoningEffortLabel(effort),
                      systemImage: effort == session.selectedReasoningEffort ? "checkmark" : "gauge.with.dots.needle.67percent"
                    )
                  }
                }
              } label: {
                HStack(spacing: 10) {
                  Image(systemName: "gauge.with.dots.needle.67percent")
                  Text(reasoningEffortLabel(session.selectedReasoningEffort))
                  Spacer()
                  Image(systemName: "chevron.up.chevron.down")
                    .font(.caption.weight(.bold))
                }
                .foregroundStyle(ClawDadTheme.cream)
              }
            }
          }

          ClawDadPanel {
            VStack(alignment: .leading, spacing: 10) {
              Text("Access")
                .font(.caption.weight(.black))
                .textCase(.uppercase)
                .foregroundStyle(ClawDadTheme.gold)
              HStack(spacing: 8) {
                ForEach(ClawDadAccessMode.allCases) { mode in
                  Button {
                    accessMode = mode
                  } label: {
                    Text(mode.label)
                      .frame(maxWidth: .infinity)
                  }
                  .buttonStyle(ClawDadSegmentButtonStyle(selected: accessMode == mode))
                }
              }
            }
          }
        }
        .padding(18)
      }
    }
    .onAppear {
      session.requestModels()
    }
    .onChange(of: selectedPhotoItems) { _, items in
      importSelectedPhotos(items)
    }
  }

  private func importSelectedPhotos(_ items: [PhotosPickerItem]) {
    guard !items.isEmpty, !importingImages, remainingImageCapacity > 0 else {
      return
    }
    importingImages = true
    imageImportError = ""
    let selectedItems = Array(items.prefix(remainingImageCapacity))
    let firstSequence = imageAttachments.count

    Task { @MainActor in
      var imported: [MobileImageAttachment] = []
      do {
        for (index, item) in selectedItems.enumerated() {
          guard let sourceData = try await item.loadTransferable(type: Data.self) else {
            throw MobileImageAttachmentError.unreadable
          }
          let attachment = try await Task.detached(priority: .userInitiated) {
            try makeMobileImageAttachment(from: sourceData, sequence: firstSequence + index)
          }.value
          imported.append(attachment)
        }
        imageAttachments.append(contentsOf: imported)
      } catch {
        imageImportError = error.localizedDescription
      }
      selectedPhotoItems = []
      importingImages = false
    }
  }
}

private func reasoningEffortLabel(_ effort: String) -> String {
  switch effort.lowercased() {
  case "xhigh":
    return "XHigh"
  default:
    return effort.capitalized
  }
}

struct SettingsView: View {
  @EnvironmentObject private var session: CloudSession
  @EnvironmentObject private var subscription: SubscriptionManager
  @Environment(\.dismiss) private var dismiss
  @State private var showingAdvanced = false
  @State private var showingForgetPairingConfirm = false
  var openScanner: () -> Void

  private var connectionTitle: String {
    guard session.paired else {
      return "Pair this iPhone"
    }
    switch session.state {
    case .connected:
      return session.hostOnline
        ? "Connected to \(session.hostId)"
        : "Cloud connected, Mac offline"
    case .connecting:
      return "Connecting to \(session.hostId)"
    case .failed:
      return "Connection needs attention"
    case .disconnected:
      return "Paired with \(session.pairedHostId)"
    }
  }

  private var connectionDetail: String {
    if !session.paired {
      return session.pairingStatus.isEmpty
        ? "Scan the Pair iPhone QR from ClawDad Settings on your Mac."
        : session.pairingStatus
    }
    if !session.pairingStatus.isEmpty {
      return session.pairingStatus
    }
    switch session.state {
    case .connected:
      return session.hostOnline
        ? "Projects and Codex threads sync through \(session.hostId)."
        : "The secure relay is online. ClawDad will resume syncing when your Mac host returns."
    case .connecting:
      return "ClawDad is opening the secure relay."
    case .failed(let message):
      return message
    case .disconnected:
      return "Open ClawDad or tap Connect to resume the secure relay."
    }
  }

  var body: some View {
    NavigationStack {
      ZStack {
        ClawDadTheme.background
          .ignoresSafeArea()

        ScrollView {
          VStack(spacing: 14) {
            ClawDadPanel {
              VStack(alignment: .leading, spacing: 12) {
                Text("Connection")
                  .font(.caption.weight(.black))
                  .textCase(.uppercase)
                  .foregroundStyle(ClawDadTheme.gold)
                Text(connectionTitle)
                  .font(.headline.weight(.heavy))
                  .foregroundStyle(ClawDadTheme.cream)
                Text(connectionDetail)
                  .font(.subheadline)
                  .foregroundStyle(ClawDadTheme.peach.opacity(0.78))
                pairingActions
              }
            }

            ClawDadPanel {
              VStack(alignment: .leading, spacing: 12) {
                Text("Subscription")
                  .font(.caption.weight(.black))
                  .textCase(.uppercase)
                  .foregroundStyle(ClawDadTheme.gold)
                Text(subscription.accessLabel)
                  .font(.headline.weight(.heavy))
                  .foregroundStyle(ClawDadTheme.cream)
                HStack(spacing: 16) {
                  Button("Restore Purchases") {
                    Task {
                      await subscription.restore()
                    }
                  }
                  .buttonStyle(.plain)
                  Link(
                    "Manage Subscription",
                    destination: URL(string: "https://apps.apple.com/account/subscriptions")!
                  )
                }
                .font(.subheadline.weight(.bold))
                .foregroundStyle(ClawDadTheme.peach)
              }
            }

            ClawDadPanel {
              VStack(alignment: .leading, spacing: 12) {
                DisclosureGroup(isExpanded: $showingAdvanced) {
                  VStack(alignment: .leading, spacing: 10) {
                    LabeledContent("Relay") {
                      Text(URL(string: session.cloudUrl)?.host ?? session.cloudUrl)
                    }
                    LabeledContent("Mac") {
                      Text(session.hostId)
                    }
                    LabeledContent("Device access") {
                      Text("Keychain protected")
                        .foregroundStyle(ClawDadTheme.good)
                    }
                    .font(.caption)
                    .foregroundStyle(ClawDadTheme.peach.opacity(0.82))
                    DeviceIdentityRow()
                  }
                  .padding(.top, 8)
                } label: {
                  VStack(alignment: .leading, spacing: 4) {
                    Text("Advanced Connection")
                      .font(.caption.weight(.black))
                      .textCase(.uppercase)
                      .foregroundStyle(ClawDadTheme.gold)
                    Text("Relay, Mac, and protected device identity")
                      .font(.caption)
                      .foregroundStyle(ClawDadTheme.peach.opacity(0.72))
                  }
                }
                .tint(ClawDadTheme.cream)
              }
            }
          }
          .padding(18)
        }
      }
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Done") {
            dismiss()
          }
          .foregroundStyle(ClawDadTheme.cream)
        }
      }
      .navigationTitle("Settings")
      .clawDadInlineNavigationTitle()
      .confirmationDialog(
        "Forget this pairing?",
        isPresented: $showingForgetPairingConfirm,
        titleVisibility: .visible
      ) {
        Button("Forget Pairing", role: .destructive) {
          session.forgetPairing()
        }
        Button("Cancel", role: .cancel) {}
      } message: {
        Text("This clears the saved trust on this iPhone and returns ClawDad to the QR pairing flow.")
      }
    }
  }

  private var pairingActions: some View {
    ViewThatFits(in: .horizontal) {
      HStack(spacing: 10) {
        pairingActionButtons
      }
      VStack(spacing: 10) {
        pairingActionButtons
      }
    }
  }

  @ViewBuilder
  private var pairingActionButtons: some View {
    Button {
      openScanner()
    } label: {
      Label("Scan QR", systemImage: "qrcode.viewfinder")
    }
    .buttonStyle(ClawDadPrimaryButtonStyle())

    if session.paired {
      if session.connected {
        Button {
          session.requestCatalog()
        } label: {
          Label("Refresh", systemImage: "arrow.clockwise")
        }
        .buttonStyle(ClawDadSecondaryButtonStyle())

        Button {
          session.disconnect()
        } label: {
          Label("Disconnect", systemImage: "power")
        }
        .buttonStyle(ClawDadSecondaryButtonStyle())
      } else {
        Button {
          session.connect()
        } label: {
          Label("Connect", systemImage: "bolt.horizontal.fill")
        }
        .buttonStyle(ClawDadSecondaryButtonStyle())
      }

      Button {
        showingForgetPairingConfirm = true
      } label: {
        Label("Forget Pairing", systemImage: "trash")
      }
      .buttonStyle(ClawDadSecondaryButtonStyle())
    }
  }

  private func clawField(_ title: String, text: Binding<String>) -> some View {
    #if os(iOS)
    return TextField(title, text: text)
      .textInputAutocapitalization(.never)
      .autocorrectionDisabled()
      .textFieldStyle(ClawDadTextFieldStyle())
    #else
    return TextField(title, text: text)
      .textFieldStyle(ClawDadTextFieldStyle())
    #endif
  }
}

struct DeviceIdentityRow: View {
  @State private var deviceId = ""
  @State private var keyId = ""

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      Text("Device Key")
        .font(.caption.weight(.black))
        .textCase(.uppercase)
        .foregroundStyle(ClawDadTheme.gold)
      Text(deviceId.isEmpty ? "Device pending" : deviceId)
        .font(.caption.monospaced())
        .foregroundStyle(ClawDadTheme.cream)
        .lineLimit(1)
      Text(keyId.isEmpty ? "Signing key pending" : keyId)
        .font(.caption.monospaced())
        .foregroundStyle(ClawDadTheme.peach.opacity(0.72))
        .lineLimit(1)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .task {
      deviceId = (try? DeviceIdentity.shared.deviceId()) ?? ""
      keyId = (try? DeviceIdentity.shared.publicKeyId()) ?? ""
    }
  }
}

struct ClawDadPanel<Content: View>: View {
  @ViewBuilder var content: Content

  var body: some View {
    content
      .padding(14)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(ClawDadTheme.panel, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
      .overlay(
        RoundedRectangle(cornerRadius: 8, style: .continuous)
          .stroke(ClawDadTheme.peach.opacity(0.13), lineWidth: 1)
      )
      .shadow(color: .black.opacity(0.18), radius: 18, y: 10)
  }
}

struct ClawDadTextFieldStyle: TextFieldStyle {
  func _body(configuration: TextField<Self._Label>) -> some View {
    configuration
      .foregroundStyle(ClawDadTheme.cream)
      .padding(.horizontal, 12)
      .padding(.vertical, 11)
      .background(ClawDadTheme.darkPanel, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
      .overlay(
        RoundedRectangle(cornerRadius: 8, style: .continuous)
          .stroke(ClawDadTheme.peach.opacity(0.18), lineWidth: 1)
      )
  }
}

struct ClawDadPrimaryButtonStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .font(.subheadline.weight(.heavy))
      .foregroundStyle(ClawDadTheme.cream)
      .frame(maxWidth: .infinity)
      .padding(.vertical, 12)
      .background(
        LinearGradient(
          colors: [Color(red: 0.72, green: 0.22, blue: 0.17), Color(red: 0.55, green: 0.10, blue: 0.09)],
          startPoint: .topLeading,
          endPoint: .bottomTrailing
        ),
        in: RoundedRectangle(cornerRadius: 8, style: .continuous)
      )
      .opacity(configuration.isPressed ? 0.78 : 1)
  }
}

struct ClawDadSecondaryButtonStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .font(.subheadline.weight(.heavy))
      .foregroundStyle(ClawDadTheme.cream)
      .frame(maxWidth: .infinity)
      .padding(.vertical, 12)
      .background(ClawDadTheme.darkPanel, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
      .overlay(
        RoundedRectangle(cornerRadius: 8, style: .continuous)
          .stroke(ClawDadTheme.gold.opacity(0.42), lineWidth: 1)
      )
      .opacity(configuration.isPressed ? 0.78 : 1)
  }
}

struct ClawDadIconButtonStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .foregroundStyle(ClawDadTheme.cream)
      .contentShape(Rectangle())
      .scaleEffect(configuration.isPressed ? 0.86 : 1)
      .opacity(configuration.isPressed ? 0.62 : 1)
      .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
  }
}

struct ClawDadVoiceButtonStyle: ButtonStyle {
  var recording: Bool

  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .foregroundStyle(recording ? ClawDadTheme.cream : ClawDadTheme.cream.opacity(0.94))
      .background(
        recording ? ClawDadTheme.danger.opacity(0.88) : Color.clear,
        in: Circle()
      )
      .overlay(
        Circle()
          .stroke(
            recording ? ClawDadTheme.peach.opacity(0.82) : Color.clear,
            lineWidth: 1.5
          )
      )
      .shadow(
        color: recording ? ClawDadTheme.danger.opacity(0.46) : .clear,
        radius: recording ? 10 : 0
      )
      .scaleEffect(configuration.isPressed ? 0.9 : 1)
      .opacity(configuration.isPressed ? 0.8 : 1)
      .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
  }
}

struct ClawDadGhostButtonStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .foregroundStyle(ClawDadTheme.cream.opacity(configuration.isPressed ? 0.58 : 0.86))
      .background(Color.clear)
      .contentShape(Rectangle())
  }
}

struct ClawDadCompactButtonStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .font(.caption.weight(.heavy))
      .foregroundStyle(ClawDadTheme.cream)
      .padding(.horizontal, 12)
      .padding(.vertical, 9)
      .background(ClawDadTheme.panel, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
      .overlay(
        RoundedRectangle(cornerRadius: 8, style: .continuous)
          .stroke(ClawDadTheme.gold.opacity(0.38), lineWidth: 1)
      )
      .opacity(configuration.isPressed ? 0.76 : 1)
  }
}

struct ClawDadClawButtonStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .contentShape(Rectangle())
      .shadow(color: .black.opacity(0.34), radius: 8, y: 4)
      .scaleEffect(configuration.isPressed ? 0.88 : 1)
      .opacity(configuration.isPressed ? 0.7 : 1)
      .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
  }
}

struct ClawDadSegmentButtonStyle: ButtonStyle {
  var selected: Bool

  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .font(.caption.weight(.heavy))
      .foregroundStyle(selected ? ClawDadTheme.cream : ClawDadTheme.peach.opacity(0.82))
      .padding(.vertical, 11)
      .background(
        selected ? ClawDadTheme.panel : ClawDadTheme.darkPanel,
        in: RoundedRectangle(cornerRadius: 8, style: .continuous)
      )
      .overlay(
        RoundedRectangle(cornerRadius: 8, style: .continuous)
          .stroke(selected ? ClawDadTheme.gold.opacity(0.6) : ClawDadTheme.peach.opacity(0.14), lineWidth: 1)
      )
      .opacity(configuration.isPressed ? 0.76 : 1)
  }
}

enum ClawDadDispatchMode: String, CaseIterable, Identifiable {
  case direct
  case queue

  var id: String { rawValue }

  var label: String {
    switch self {
    case .direct:
      return "Direct"
    case .queue:
      return "Queue"
    }
  }
}

enum ClawDadAccessMode: String, CaseIterable, Identifiable {
  case repo
  case full

  var id: String { rawValue }

  var label: String {
    switch self {
    case .repo:
      return "Repo scoped"
    case .full:
      return "Full access"
    }
  }

  var permissionMode: String {
    switch self {
    case .repo:
      return "approve"
    case .full:
      return "full"
    }
  }
}

enum ClawDadTheme {
  static let cream = Color(red: 1.0, green: 0.93, blue: 0.78)
  static let peach = Color(red: 0.94, green: 0.70, blue: 0.56)
  static let gold = Color(red: 0.95, green: 0.72, blue: 0.22)
  static let good = Color(red: 0.42, green: 0.85, blue: 0.46)
  static let danger = Color(red: 0.84, green: 0.16, blue: 0.16)
  static let panel = Color(red: 0.43, green: 0.06, blue: 0.07).opacity(0.88)
  static let darkPanel = Color(red: 0.18, green: 0.01, blue: 0.02).opacity(0.92)
  static let background = LinearGradient(
    colors: [
      Color(red: 0.42, green: 0.03, blue: 0.04),
      Color(red: 0.22, green: 0.0, blue: 0.01),
      Color(red: 0.52, green: 0.07, blue: 0.06)
    ],
    startPoint: .topLeading,
    endPoint: .bottomTrailing
  )
}

extension View {
  @ViewBuilder
  func clawDadNavigationHidden() -> some View {
    #if os(iOS)
    self.toolbar(.hidden, for: .navigationBar)
    #else
    self
    #endif
  }

  @ViewBuilder
  func clawDadInlineNavigationTitle() -> some View {
    #if os(iOS)
    self.navigationBarTitleDisplayMode(.inline)
    #else
    self
    #endif
  }

  @ViewBuilder
  func clawDadScannerCover<Content: View>(
    isPresented: Binding<Bool>,
    @ViewBuilder content: @escaping () -> Content
  ) -> some View {
    #if os(iOS)
    self.fullScreenCover(isPresented: isPresented, content: content)
    #else
    self.sheet(isPresented: isPresented, content: content)
    #endif
  }

  @ViewBuilder
  func clawDadRemoteAssistCover<Content: View>(
    isPresented: Binding<Bool>,
    @ViewBuilder content: @escaping () -> Content
  ) -> some View {
    #if os(iOS)
    self.fullScreenCover(isPresented: isPresented, content: content)
    #else
    self.sheet(isPresented: isPresented, content: content)
    #endif
  }
}
