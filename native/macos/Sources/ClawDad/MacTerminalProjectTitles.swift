import AppKit
import ApplicationServices
import CryptoKit
import ClawDadRemoteAssistProtocol
import Darwin
import Foundation

/// Display metadata only. These identities never authorize input or identify a
/// conversation. The login process fences reused TTYs across Terminal restarts.
struct MacTerminalTitleMetadata: Equatable, Sendable {
  let tty: String
  let lifetime: String
  let foreground: String
  let directory: String?
  let kind: String

  static func read(_ tty: String,
    run: @Sendable (String, [String]) throws -> String = { try macTerminalResponseCommand($0, $1) },
    arguments: @Sendable (String) -> [String]? = { macCodexProcessArguments($0) }
  ) throws -> Self {
    let rows = try processes(tty, run: run)
    let lifetime = try lifetime(tty, rows: rows)
    let owners = rows.filter { $0.count == 10 && $0[1] == $0[2] && !$0[3].contains("T") && !$0[3].contains("Z") }
    let agents = owners.filter { URL(fileURLWithPath: $0[9]).lastPathComponent == "codex" }
    let shells = owners.filter { ["zsh", "bash", "sh"].contains(URL(fileURLWithPath: $0[9]).lastPathComponent.trimmingCharacters(in: CharacterSet(charactersIn: "-"))) }
    let owner = agents.count == 1 ? agents.first : (agents.isEmpty && owners.count == 1 && shells.count == 1 ? shells.first : nil)
    guard let owner else { return Self(tty: tty, lifetime: lifetime, foreground: "unavailable", directory: nil, kind: "unavailable") }
    let signature = (owner.prefix(3) + owner.dropFirst(4)).joined(separator: "|")
    let files = try run("/usr/sbin/lsof", ["-a", "-p", owner[0], "-d", "cwd,txt", "-Fn"])
    var field = "", directories = Set<String>(), executable = false
    for line in files.split(separator: "\n") {
      if line.hasPrefix("f") { field = String(line.dropFirst()) }
      if line.hasPrefix("n/") {
        let path = String(line.dropFirst())
        if field == "cwd" { directories.insert(URL(fileURLWithPath: path).resolvingSymlinksInPath().path) }
        if field == "txt", URL(fileURLWithPath: path).lastPathComponent == "codex" { executable = true }
      }
    }
    guard directories.count == 1, let cwd = directories.first else { throw MacAssistantError("The Terminal directory is not yet verifiable.") }
    let isAgent = !agents.isEmpty
    guard !isAgent || executable else { throw MacAssistantError("The active agent executable is not yet verifiable.") }
    let argv = isAgent ? arguments(owner[0]) : nil
    guard !isAgent || argv != nil else { throw MacAssistantError("The active agent directory arguments are not readable yet.") }
    let directory = isAgent ? try macCodexInputDirectory(processDirectory: cwd, arguments: argv) : cwd
    let after = try processes(tty, run: run)
    guard try Self.lifetime(tty, rows: after) == lifetime,
      after.contains(where: { ($0.prefix(3) + $0.dropFirst(4)).joined(separator: "|") == signature }) else {
      throw MacAssistantError("The Terminal process changed while reading its directory.")
    }
    return Self(tty: tty, lifetime: lifetime, foreground: signature, directory: directory, kind: isAgent ? "codex" : "shell")
  }

  static func processes(_ tty: String, run: @Sendable (String, [String]) throws -> String = { try macTerminalResponseCommand($0, $1) }) throws -> [[String]] {
    guard tty.range(of: #"^/dev/tty[A-Za-z0-9]+$"#, options: .regularExpression) != nil else { throw AssistantProtocolError.invalid }
    return try run("/bin/ps", ["-t", String(tty.dropFirst(5)), "-o", "pid=,pgid=,tpgid=,stat=,lstart=,comm="])
      .split(separator: "\n").map { $0.split(maxSplits: 9, whereSeparator: \.isWhitespace).map { $0.trimmingCharacters(in: .whitespaces) } }
  }
  static func lifetime(_ tty: String, rows: [[String]]) throws -> String {
    let login = rows.filter { $0.count == 10 && URL(fileURLWithPath: $0[9]).lastPathComponent == "login" }
    guard login.count == 1, let row = login.first else { throw MacAssistantError("The Terminal tab lifetime could not be verified; its name was preserved.") }
    return SHA256.hash(data: Data((tty + "\n" + (row.prefix(1) + row.dropFirst(4)).joined(separator: "|")).utf8))
      .map { String(format: "%02x", $0) }.joined()
  }
  static func currentLifetime(_ tty: String) throws -> String { try lifetime(tty, rows: processes(tty)) }
}

struct MacTerminalSavedName: Codable, Equatable {
  let lifetime: String
  let tty: String
  var name: String
  let source: String
}

/// One native owner writes names on the internal drive. A name follows this
/// live Terminal tab; Main Workspace explicitly rebinds it during restoration.
@MainActor
final class MacTerminalProjectTitles {
  static let shared = MacTerminalProjectTitles()
  private let url: URL
  private var names: [String: MacTerminalSavedName]
  private var storageError: String?
  private var metadata: [String: MacTerminalTitleMetadata] = [:]
  private var writtenDirectories: [String: String] = [:]
  private(set) var refreshTask: Task<Void, Never>?
  private var refreshedAt = Date.distantPast
  private var changing = Set<String>()
  private var pendingNames: [String: (name: String, window: String, since: Date)] = [:]
  private let readMetadata: @Sendable (String) throws -> MacTerminalTitleMetadata
  private let writeOutput: @Sendable (MacTerminalTitleMetadata, Data) throws -> Void
  private let readWindowTitle: @Sendable (String) throws -> String
  init(url: URL = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/ClawDad/TerminalTitles/names.json"),
    readMetadata: @escaping @Sendable (String) throws -> MacTerminalTitleMetadata = { try MacTerminalTitleMetadata.read($0) },
    writeOutput: @escaping @Sendable (MacTerminalTitleMetadata, Data) throws -> Void = { try MacTerminalProjectTitles.nativeWrite($0, bytes: $1) },
    readWindowTitle: @escaping @Sendable (String) throws -> String = { try MacTerminalProjectTitles.windowTitle($0) }
  ) {
    self.url = url
    self.readMetadata = readMetadata; self.writeOutput = writeOutput; self.readWindowTitle = readWindowTitle
    names = [:]
    if FileManager.default.fileExists(atPath: url.path) {
      do { names = try JSONDecoder().decode([String: MacTerminalSavedName].self, from: Data(contentsOf: url)) }
      catch { storageError = "Saved tab names could not be read. Their file was preserved; repair it before renaming." }
    }
  }
  static func validateName(_ name: String) throws {
    guard !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, name.utf8.count <= 256,
      !name.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }) else {
      throw MacAssistantError("Use a tab name of 1–256 UTF-8 bytes without control characters.")
    }
  }
  func explicitName(tty: String) -> String? {
    guard let current = metadata[tty], let saved = names[current.lifetime], saved.tty == tty else { return nil }
    return saved.name
  }
  func refresh(_ snapshots: [MacTerminalTabSnapshot]) {
    guard refreshTask == nil, Date().timeIntervalSince(refreshedAt) >= 3 else { return }
    let ttys = Set(snapshots.flatMap(\.activityTTYs)).union(snapshots.map(\.tty).filter { !$0.isEmpty }).union(names.values.map(\.tty))
    let readMetadata = self.readMetadata
    refreshTask = Task { [weak self] in
      let observed = await Task.detached(priority: .utility) {
        ttys.compactMap { try? readMetadata($0) }
      }.value
      guard let self else { return }
      metadata = Dictionary(uniqueKeysWithValues: observed.map { ($0.tty, $0) })
      for value in observed {
        let savedName = explicitName(tty: value.tty)
        let nativeNameVisible = snapshots.contains { ($0.tty == value.tty || $0.activityTTYs == [value.tty]) && $0.customTitle == savedName }
        // Native directory metadata is independent of the window/tab title. A
        // -C launch gets the verified agent directory before its first rollout.
        if let directory = value.directory,
          writtenDirectories[value.lifetime] != value.foreground + "\n" + directory || (savedName != nil && !nativeNameVisible) {
          do {
            try await write(value, directory: directory, name: savedName)
            writtenDirectories[value.lifetime] = value.foreground + "\n" + directory
          } catch { /* Retry display metadata on a later observation; never type. */ }
        }
      }
      refreshedAt = Date(); refreshTask = nil
    }
  }
  func title(for snapshot: MacTerminalTabSnapshot, now: Date = Date()) -> String {
    if let current = metadata[snapshot.tty], let configured = snapshot.configuredTitle,
      names[current.lifetime] == nil || names[current.lifetime]?.source == "window_custom" {
      // Terminal's configured profile title retains explicit user changes;
      // program OSC titles change only its live custom-title value. The stock
      // profile title is Terminal. Explicit Tab Title / tool names win above it.
      if Self.preserveConfiguredName(configured) {
        if names[current.lifetime]?.name != configured { rememberNativeName(configured, metadata: current, source: "window_custom") }
      } else if names[current.lifetime]?.source == "window_custom" {
        var updated = names; updated.removeValue(forKey: current.lifetime)
        if (try? persist(updated)) != nil {
          names = updated; pendingNames.removeValue(forKey: current.lifetime)
          Task { try? await write(current, directory: current.directory, name: "") }
          return current.directory.map { macTerminalTabTitle(URL(fileURLWithPath: $0).lastPathComponent, generated: false) } ?? macTerminalTabTitle(snapshot.customTitle)
        }
      }
    }
    // Unknown output during a directory/process/title transition is not proof
    // of a human rename. Require a stable independent window observation before
    // remembering an otherwise distinct native Tab Title.
    if !snapshot.generatedTitle, let current = metadata[snapshot.tty], names[current.lifetime] == nil,
      let window = snapshot.activityWindowTitle, !window.isEmpty {
      let candidate = pendingNames[current.lifetime]
      if candidate?.name == snapshot.customTitle, candidate?.window == window,
        now.timeIntervalSince(candidate!.since) >= 1 {
        rememberNativeName(snapshot.customTitle, metadata: current, source: "native_custom")
      } else if candidate?.name != snapshot.customTitle || candidate?.window != window {
        pendingNames[current.lifetime] = (snapshot.customTitle, window, now)
      }
    } else if let current = metadata[snapshot.tty] { pendingNames.removeValue(forKey: current.lifetime) }
    if let name = explicitName(tty: snapshot.tty) { return macTerminalTabTitle(name, generated: false) }
    if snapshot.activityTTYs.count == 1, let tty = snapshot.activityTTYs.first, let name = explicitName(tty: tty) {
      return macTerminalTabTitle(name, generated: false) // Display only; no input binding.
    }
    // Unknown and standalone titles (including names resembling paths) remain
    // intact. Only a title matched to Terminal's generated window metadata is
    // eligible for a verified directory label.
    guard snapshot.generatedTitle else {
      // Preserve a native custom title verbatim. Its spelling, including a
      // directory-shaped name, supplies no process or conversation authority.
      return macTerminalTabTitle(snapshot.customTitle, generated: false)
    }
    let values = snapshot.activityTTYs.compactMap { metadata[$0]?.directory }
    if !values.isEmpty, values.count == snapshot.activityTTYs.count, Set(values).count == 1, let path = values.first {
      return macTerminalTabTitle(URL(fileURLWithPath: path).lastPathComponent, generated: false)
    }
    return macTerminalTabTitle(snapshot.customTitle)
  }
  nonisolated static func isGenerated(_ native: String, window: String, windowCustomTitle: String?) -> Bool {
    let value = displayKey(native)
    if value == displayKey(window) { return true }
    // Terminal can omit its window-only custom-title component in the tab
    // tooltip. Remove only that exact scripting field, never an arbitrary name.
    var parts = window.components(separatedBy: " — ")
    if let custom = windowCustomTitle, parts.count > 2, parts[1] == custom {
      parts.remove(at: 1)
      return value == displayKey(parts.joined(separator: " — "))
    }
    return false
  }
  nonisolated static func displayKey(_ title: String) -> String {
    MacTerminalActivityCandidates.key(title).replacingOccurrences(of: #"\[\s*[.!]\s*\] Action Required"#, with: "[!] Action Required", options: .regularExpression)
  }
  static func preserveConfiguredName(_ name: String) -> Bool { !name.isEmpty && name != "Terminal" }
  private func rememberNativeName(_ name: String, metadata: MacTerminalTitleMetadata, source: String) {
    guard (try? Self.validateName(name)) != nil else { return }
    var updated = names
    updated[metadata.lifetime] = MacTerminalSavedName(lifetime: metadata.lifetime, tty: metadata.tty, name: name, source: source)
    if (try? persist(updated)) != nil { names = updated }
  }
  func rename(tty: String, name: String, expectedLifetime: String) async throws {
    try Self.validateName(name)
    let readMetadata = self.readMetadata
    let value = try await Task.detached { try readMetadata(tty) }.value
    guard value.lifetime == expectedLifetime else { throw MacAssistantError("The tab changed before renaming. Inspect its current identity.") }
    metadata[tty] = value
    pendingNames.removeValue(forKey: value.lifetime)
    let record = MacTerminalSavedName(lifetime: value.lifetime, tty: tty, name: name, source: "user")
    var updated = names; updated[value.lifetime] = record
    try persist(updated); names = updated // Durable before output; retry is idempotent.
    try await write(value, directory: value.directory, name: name)
  }
  private func persist(_ values: [String: MacTerminalSavedName]) throws {
    if let storageError { throw MacAssistantError(storageError) }
    try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    try JSONEncoder().encode(values).write(to: url, options: .atomic)
    try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
    let fd = open(url.path, O_RDONLY); if fd >= 0 { _ = fsync(fd); close(fd) }
    let directory = open(url.deletingLastPathComponent().path, O_RDONLY); if directory >= 0 { _ = fsync(directory); close(directory) }
  }
  /// Program OSC title updates can replace even Terminal's Inspector Tab Title.
  /// Repair only generated title updates. A different native custom name wins,
  /// including one that happens to be a path; its spelling is never normalized.
  func nativeTitleChanged(tty: String, value: String, generated: Bool, userEdited: Bool = false) {
    guard let owner = metadata[tty] else { return }
    if userEdited, names[owner.lifetime]?.name != value {
      // Evidence comes from the visible native Inspector Tab Title field and
      // its exact displayed TTY, not from the spelling of the proposed name.
      pendingNames.removeValue(forKey: owner.lifetime)
      rememberNativeName(value, metadata: owner, source: "user")
      return
    }
    guard let saved = names[owner.lifetime], saved.tty == tty,
      value != saved.name, !changing.contains(tty) else { return }
    changing.insert(tty)
    let readWindowTitle = self.readWindowTitle
    Task { [weak self] in
      guard let self else { return }; defer { changing.remove(tty) }
      do {
        let windowTitle = !generated && value.contains(" — ") ? try await Task.detached { try readWindowTitle(tty) }.value : nil
        if generated || windowTitle.map({ Self.displayKey($0) == Self.displayKey(value) }) == true {
          try await write(owner, directory: nil, name: saved.name)
        } // A distinct title is considered by the stable catalog observation.
      } catch {
        if ProcessInfo.processInfo.environment["CLAWDAD_TITLE_FIXTURE_TTY"] == tty { print("TITLE_REPAIR_ERROR", error.localizedDescription) }
        /* No input fallback. Retain the approved name for reconciliation. */
      }
    }
  }
  static func output(directory: String?, name: String?) -> Data {
    var result = ""
    if let directory {
      var url = URLComponents(); url.scheme = "file"; url.host = ProcessInfo.processInfo.hostName; url.path = directory
      if let encoded = url.string { result += "\u{1b}]7;" + encoded + "\u{7}" }
    }
    if let name { result += "\u{1b}]1;" + name + "\u{7}" }
    return Data(result.utf8)
  }
  nonisolated static func windowTitle(_ tty: String) throws -> String {
    guard tty.range(of: #"^/dev/tty[A-Za-z0-9]+$"#, options: .regularExpression) != nil else { throw AssistantProtocolError.invalid }
    let code = """
    tell application "Terminal"
      set namesByWindow to name of windows
      set ttysByWindow to tty of tabs of windows
    end tell
    set matches to {}
    repeat with i from 1 to count of namesByWindow
      try
        if (item i of ttysByWindow) contains "\(tty)" then set end of matches to item i of namesByWindow
      end try
    end repeat
    if (count matches) is not 1 then error "Tab changed"
    return item 1 of matches
    """
    return try macTerminalResponseCommand("/usr/bin/osascript", ["-e", code]).trimmingCharacters(in: .whitespacesAndNewlines)
  }
  private func write(_ owner: MacTerminalTitleMetadata, directory: String?, name: String?) async throws {
    let bytes = Self.output(directory: directory, name: name)
    let writeOutput = self.writeOutput
    try await Task.detached(priority: .utility) { try writeOutput(owner, bytes) }.value
  }
  nonisolated static func nativeWrite(_ owner: MacTerminalTitleMetadata, bytes: Data) throws {
    guard AXIsProcessTrusted(), !MacConsoleSessionState.isLocked() else {
      throw MacAssistantError("Unlock the Mac and allow ClawDad Accessibility to update Terminal display names.")
    }
    guard try MacTerminalTitleMetadata.currentLifetime(owner.tty) == owner.lifetime else { throw MacAssistantError("The Terminal tab lifetime changed.") }
    if bytes.range(of: Data("\u{1b}]7;".utf8)) != nil {
      let latest = try MacTerminalTitleMetadata.read(owner.tty)
      guard latest == owner else { throw MacAssistantError("The Terminal directory changed before its display metadata could be updated. It will be refreshed.") }
    }
    let fd = open(owner.tty, O_WRONLY | O_NOCTTY | O_NONBLOCK)
    guard fd >= 0 else { throw MacAssistantError("Terminal's display metadata is unavailable.") }; defer { close(fd) }
    var details = stat()
    guard fstat(fd, &details) == 0, (details.st_mode & S_IFMT) == S_IFCHR else { throw MacAssistantError("The Terminal display device changed.") }
    // Write terminal OUTPUT, never stdin, keystrokes or a paste.
    let count = bytes.withUnsafeBytes { Darwin.write(fd, $0.baseAddress, $0.count) }
    guard count == bytes.count else { throw MacAssistantError("The tab name needs reconciliation. No input was sent.") }
  }
}

/// Event-driven repair avoids a polling race with Codex's animated OSC title.
/// All elements come from the already verified native tab catalog.
struct MacTerminalTitleEventBatch {
  private var pending: [String] = []
  var hasPending: Bool { !pending.isEmpty }
  mutating func enqueue(_ tty: String) {
    if !pending.contains(tty), pending.count < 128 { pending.append(tty) }
  }
  mutating func take(_ count: Int) -> [String] {
    let result = Array(pending.prefix(max(0, count))); pending.removeFirst(result.count); return result
  }
}

final class MacTerminalTitleNotifications {
  private var observer: AXObserver?
  private var processId: pid_t?
  private var watched: [(AXUIElement, String, String?)] = []
  private var batch = MacTerminalTitleEventBatch()
  private var scheduled: DispatchWorkItem?
  private var lastTitle: [String: String] = [:]
  private let callback: @Sendable (String, String, Bool, Bool) -> Void
  init(callback: @escaping @Sendable (String, String, Bool, Bool) -> Void) { self.callback = callback }
  func update(pid: pid_t, bindings: [(AXUIElement, String, String?)]) {
    if processId != pid {
      if let observer { CFRunLoopRemoveSource(CFRunLoopGetMain(), AXObserverGetRunLoopSource(observer), .commonModes) }
      scheduled?.cancel(); scheduled = nil; batch = .init(); lastTitle = [:]
      observer = nil; watched = []; processId = pid
    }
    if observer == nil {
      var result: AXObserver?
      guard AXObserverCreate(pid, { _, element, _, context in
        guard let context else { return }
        let owner = Unmanaged<MacTerminalTitleNotifications>.fromOpaque(context).takeUnretainedValue()
        owner.enqueue(element)
      }, &result) == .success, let result else { return }
      observer = result
      CFRunLoopAddSource(CFRunLoopGetMain(), AXObserverGetRunLoopSource(result), .commonModes)
    }
    guard let observer else { return }
    for (element, _, _) in watched { AXObserverRemoveNotification(observer, element, kAXTitleChangedNotification as CFString) }
    watched = bindings
    for (element, _, _) in bindings {
      _ = AXObserverAddNotification(observer, element, kAXTitleChangedNotification as CFString, Unmanaged.passUnretained(self).toOpaque())
      enqueue(element) // Reconcile cold starts and a missed native notification.
    }
  }
  private func enqueue(_ element: AXUIElement) {
    guard let entry = watched.first(where: { CFEqual($0.0, element) }) else { return }
    batch.enqueue(entry.1)
    schedule()
  }
  private func schedule() {
    guard scheduled == nil, batch.hasPending else { return }
    let item = DispatchWorkItem { [weak self] in
      guard let self else { return }
      scheduled = nil
      // An AX title callback must never synchronously scan all Terminal
      // windows/Inspector on every animation frame. Yield between small batches
      // so composer inspection, native key dispatch and manual control can run.
      for tty in batch.take(4) {
        if let entry = watched.first(where: { $0.1 == tty }) { changed(entry.0) }
      }
      schedule()
    }
    scheduled = item
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.15, execute: item)
  }
  private func changed(_ element: AXUIElement) {
    guard let entry = watched.first(where: { CFEqual($0.0, element) }) else { return }
    var raw: CFTypeRef?
    AXUIElementSetMessagingTimeout(element, 0.05)
    guard AXUIElementCopyAttributeValue(element, kAXTitleAttribute as CFString, &raw) == .success, let title = raw as? String else { return }
    guard lastTitle[entry.1] != title else { return }
    lastTitle[entry.1] = title
    let generated = entry.2.map { MacTerminalProjectTitles.isGenerated(title, window: $0, windowCustomTitle: nil) } == true
    callback(entry.1, title, generated, !generated && explicitTitleEdit(title, tty: entry.1))
  }
  private func explicitTitleEdit(_ title: String, tty: String) -> Bool {
    guard let processId else { return false }
    func value(_ element: AXUIElement, _ attribute: String) -> CFTypeRef? {
      AXUIElementSetMessagingTimeout(element, 0.05)
      var result: CFTypeRef?
      return AXUIElementCopyAttributeValue(element, attribute as CFString, &result) == .success ? result : nil
    }
    let app = AXUIElementCreateApplication(processId)
    guard let windows = value(app, kAXWindowsAttribute) as? [AXUIElement],
      let inspector = windows.first(where: { value($0, kAXTitleAttribute) as? String == "Inspector" }) else { return false }
    var pending = [inspector], count = 0, exactTTY = false, editedTitle = false
    while !pending.isEmpty, count < 100 {
      let element = pending.removeFirst(); count += 1
      let text = value(element, kAXValueAttribute) as? String
      if text == tty { exactTTY = true }
      if value(element, kAXRoleAttribute) as? String == kAXTextFieldRole,
        value(element, "AXPlaceholderValue") as? String == "Tab Title", text == title { editedTitle = true }
      pending += value(element, kAXChildrenAttribute) as? [AXUIElement] ?? []
    }
    return exactTTY && editedTitle
  }
  deinit { scheduled?.cancel(); if let observer { CFRunLoopRemoveSource(CFRunLoopGetMain(), AXObserverGetRunLoopSource(observer), .commonModes) } }
}

@MainActor
struct MacTerminalProjectLaunch {
  static func draft(directory: String, stage: String, metadata: MacTerminalTitleMetadata) throws -> String {
    guard directory.hasPrefix("/"), !directory.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }),
      directory.utf8.count <= 4096, ["directory", "codex"].contains(stage), metadata.kind == "shell" else {
      throw MacAssistantError("Prepare a project launch in an inspected ordinary shell using an absolute directory.")
    }
    var isDirectory: ObjCBool = false
    guard FileManager.default.fileExists(atPath: directory, isDirectory: &isDirectory), isDirectory.boolValue else {
      throw MacAssistantError("The requested directory is unavailable. Mount its drive or restore the directory, then retry.")
    }
    if stage == "directory" { return "cd -- " + MacMainWorkspaceNative.quoted(directory) }
    guard metadata.directory == URL(fileURLWithPath: directory).resolvingSymlinksInPath().path else {
      throw MacAssistantError("The shell is still in another directory. Prepare and explicitly submit the directory step, then inspect before launching Codex.")
    }
    return "codex -C " + MacMainWorkspaceNative.quoted(directory)
  }
}
