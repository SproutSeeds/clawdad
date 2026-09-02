import AppKit
import Darwin
import Foundation
import Security
import WebKit

private let appName = "ClawDad"
private let localHost = "127.0.0.1"
private let preferredPort = 4487
private let fallbackPortStart = 4488
private let fallbackPortEnd = 4517

struct ClawDadHealth {
  let ok: Bool
  let service: String
  let authMode: String
}

final class ClawDadSecrets {
  private static let service = "earth.frg.ClawDad"
  private static let account = "native-server-token"

  static func nativeToken() throws -> String {
    if let existing = readToken() {
      return existing
    }
    let token = randomHex(byteCount: 32)
    try saveToken(token)
    return token
  }

  private static func readToken() -> String? {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
      kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne
    ]
    var result: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    guard status == errSecSuccess, let data = result as? Data else {
      return nil
    }
    return String(data: data, encoding: .utf8)
  }

  private static func saveToken(_ token: String) throws {
    let data = Data(token.utf8)
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account
    ]
    SecItemDelete(query as CFDictionary)
    var item = query
    item[kSecValueData as String] = data
    let status = SecItemAdd(item as CFDictionary, nil)
    guard status == errSecSuccess else {
      throw NSError(
        domain: NSOSStatusErrorDomain,
        code: Int(status),
        userInfo: [NSLocalizedDescriptionKey: "Could not save ClawDad token to Keychain"]
      )
    }
  }

  private static func randomHex(byteCount: Int) -> String {
    var bytes = [UInt8](repeating: 0, count: byteCount)
    let status = bytes.withUnsafeMutableBytes { buffer in
      SecRandomCopyBytes(kSecRandomDefault, byteCount, buffer.baseAddress!)
    }
    if status != errSecSuccess {
      return UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()
    }
    return bytes.map { String(format: "%02x", $0) }.joined()
  }
}

final class ClawDadService {
  private static let managedServiceLabel = "earth.frg.ClawDad.NativeRuntime"
  private static let managedCloudServiceLabel = "earth.frg.ClawDad.NativeCloudHost"
  private static let legacyCloudServiceLabel = "earth.frg.ClawDad.cloud-host"

  let repoRoot: URL
  let supportDir: URL
  let tokenFile: URL
  let token: String
  let runtimeVersion: String
  private let processLock = NSLock()
  private var managedServerProcess: Process?
  private var managedCloudHostProcess: Process?

  init() throws {
    let supportDir = try Self.applicationSupportDir()
    try NativeRuntimeOrphanReaper.reap(supportDir: supportDir)
    guard let discoveredRoot = Self.findRepoRoot() else {
      throw NSError(
        domain: "ClawDad",
        code: 1,
        userInfo: [
          NSLocalizedDescriptionKey:
            "ClawDad's bundled runtime is missing. Reinstall ClawDad or set CLAWDAD_ROOT and relaunch."
        ]
      )
    }
    self.repoRoot = try Self.prepareBundledRuntime(
      discoveredRoot,
      supportDir: supportDir
    )
    self.supportDir = supportDir
    self.runtimeVersion = Self.runtimeVersion(for: self.repoRoot)
    self.tokenFile = supportDir.appendingPathComponent("native-server.token")
    self.token = try ClawDadSecrets.nativeToken()
    try FileManager.default.createDirectory(at: supportDir, withIntermediateDirectories: true)
    try "\(token)\n".write(to: tokenFile, atomically: true, encoding: .utf8)
    try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: tokenFile.path)
  }

  func start(status: @escaping (String) -> Void, ready: @escaping (Result<URL, Error>) -> Void) {
    DispatchQueue.global(qos: .userInitiated).async {
      do {
        // Builds through 34 registered the managed runtime directly with
        // launchd. That detached Node from the signed app which prevented
        // macOS from attributing removable-volume consent to ClawDad. Migrate
        // those transient jobs before choosing a port; the replacement stays
        // a child of this app for its entire lifetime.
        Self.removeManagedService(label: Self.managedCloudServiceLabel)
        Self.removeManagedService(label: Self.managedServiceLabel)
        status("Checking local ClawDad service...")
        let port = self.choosePort()
        if let health = self.health(port: port), health.ok, health.service == "clawdad-server" {
          status("Connecting to local ClawDad service...")
          self.startManagedCloudHostIfNeeded(port: port, status: status)
          ready(.success(self.baseURL(port: port)))
          return
        }

        status("Starting local ClawDad service...")
        try self.startManagedService(port: port)
        try self.waitForHealth(port: port, status: status)
        self.startManagedCloudHostIfNeeded(port: port, status: status)
        ready(.success(self.baseURL(port: port)))
      } catch {
        ready(.failure(error))
      }
    }
  }

  func authenticatedRequest(for baseURL: URL) -> URLRequest {
    var request = URLRequest(url: baseURL)
    request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
    return request
  }

  func stop() {
    processLock.lock()
    let processes = [managedCloudHostProcess, managedServerProcess].compactMap { $0 }
    managedCloudHostProcess = nil
    managedServerProcess = nil
    processLock.unlock()
    for process in processes {
      NativeManagedProcessTerminator.stop(process)
    }
    Self.removeManagedService(label: Self.managedCloudServiceLabel)
    Self.removeManagedService(label: Self.managedServiceLabel)
  }

  private func choosePort() -> Int {
    if let health = health(port: preferredPort),
       health.ok,
       health.service == "clawdad-server",
       health.authMode != "tailscale",
       authenticatedCheck(port: preferredPort) {
      return preferredPort
    }
    if portIsBindable(preferredPort) {
      return preferredPort
    }
    for port in fallbackPortStart...fallbackPortEnd {
      if portIsBindable(port) {
        return port
      }
      if let health = health(port: port),
         health.ok,
         health.service == "clawdad-server",
         health.authMode != "tailscale",
         authenticatedCheck(port: port) {
        return port
      }
    }
    return fallbackPortStart
  }

  private func baseURL(port: Int) -> URL {
    URL(string: "http://\(localHost):\(port)/")!
  }

  private func health(port: Int) -> ClawDadHealth? {
    guard let url = URL(string: "http://\(localHost):\(port)/healthz") else {
      return nil
    }
    var request = URLRequest(url: url)
    request.timeoutInterval = 0.75
    let semaphore = DispatchSemaphore(value: 0)
    var parsed: ClawDadHealth?
    URLSession.shared.dataTask(with: request) { data, _, _ in
      defer { semaphore.signal() }
      guard let data,
            let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
        return
      }
      parsed = ClawDadHealth(
        ok: (json["ok"] as? Bool) == true,
        service: json["service"] as? String ?? "",
        authMode: json["authMode"] as? String ?? ""
      )
    }.resume()
    _ = semaphore.wait(timeout: .now() + 1.0)
    return parsed
  }

  private func authenticatedCheck(port: Int) -> Bool {
    guard let url = URL(
      string: "http://\(localHost):\(port)/v1/native/capabilities"
    ) else {
      return false
    }
    var request = URLRequest(url: url)
    request.timeoutInterval = 1.0
    request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    let semaphore = DispatchSemaphore(value: 0)
    var ok = false
    URLSession.shared.dataTask(with: request) { data, response, _ in
      defer { semaphore.signal() }
      guard let http = response as? HTTPURLResponse,
            http.statusCode == 200,
            let data,
            let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
        return
      }
      ok = (json["ok"] as? Bool) == true
        && (json["nativeShellProtocol"] as? Int) == 1
        && (json["remoteAssist"] as? Bool) == true
        && (json["nativeRuntimeVersion"] as? String) == self.runtimeVersion
    }.resume()
    _ = semaphore.wait(timeout: .now() + 1.25)
    return ok
  }

  private func portIsBindable(_ port: Int) -> Bool {
    let descriptor = socket(AF_INET, SOCK_STREAM, 0)
    if descriptor < 0 {
      return false
    }
    defer { Darwin.close(descriptor) }

    var address = sockaddr_in()
    address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
    address.sin_family = sa_family_t(AF_INET)
    address.sin_port = in_port_t(UInt16(port).bigEndian)
    address.sin_addr = in_addr(s_addr: inet_addr(localHost))

    let result = withUnsafePointer(to: &address) { pointer in
      pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { socketAddress in
        bind(descriptor, socketAddress, socklen_t(MemoryLayout<sockaddr_in>.size))
      }
    }
    return result == 0
  }

  private func startManagedService(port: Int) throws {
    let serverPath = repoRoot.appendingPathComponent("lib/server.mjs")
    guard FileManager.default.fileExists(atPath: serverPath.path) else {
      throw NSError(
        domain: "ClawDad",
        code: 2,
        userInfo: [NSLocalizedDescriptionKey: "Could not find \(serverPath.path)"]
      )
    }
    let nodeURL = try Self.nodeExecutableURL(repoRoot: repoRoot)

    let logsDir = supportDir.appendingPathComponent("logs")
    try FileManager.default.createDirectory(at: logsDir, withIntermediateDirectories: true)
    let stdout = logsDir.appendingPathComponent("native-server.stdout.log")
    let stderr = logsDir.appendingPathComponent("native-server.stderr.log")
    FileManager.default.createFile(atPath: stdout.path, contents: nil)
    FileManager.default.createFile(atPath: stderr.path, contents: nil)
    let stdoutHandle = try FileHandle(forWritingTo: stdout)
    let stderrHandle = try FileHandle(forWritingTo: stderr)
    try stdoutHandle.truncate(atOffset: 0)
    try stderrHandle.truncate(atOffset: 0)
    stdoutHandle.write(
      Data("Starting ClawDad server with \(nodeURL.path) on \(localHost):\(port)\n".utf8)
    )
    try stdoutHandle.seekToEnd()
    try stdoutHandle.close()
    try stderrHandle.close()

    let environment = Self.serverEnvironment(
      repoRoot: repoRoot,
      tokenFile: tokenFile
    )
    let process = Process()
    process.executableURL = nodeURL
    process.arguments = [
      serverPath.path,
      "serve",
      "--host", localHost,
      "--port", "\(port)",
      "--auth-mode", "token",
      "--token-file", tokenFile.path
    ]
    process.currentDirectoryURL = repoRoot
    process.environment = environment.merging([
      "CLAWDAD_NATIVE_RUNTIME_VERSION": runtimeVersion
    ]) { _, replacement in replacement }
    let serviceStdoutHandle = try FileHandle(forWritingTo: stdout)
    let serviceStderrHandle = try FileHandle(forWritingTo: stderr)
    try serviceStdoutHandle.seekToEnd()
    try serviceStderrHandle.seekToEnd()
    process.standardOutput = serviceStdoutHandle
    process.standardError = serviceStderrHandle
    try process.run()
    try? serviceStdoutHandle.close()
    try? serviceStderrHandle.close()
    processLock.lock()
    managedServerProcess = process
    processLock.unlock()
  }

  private func startManagedCloudHostIfNeeded(
    port: Int,
    status: @escaping (String) -> Void
  ) {
    let cloudConfig = FileManager.default.homeDirectoryForCurrentUser
      .appendingPathComponent(".clawdad", isDirectory: true)
      .appendingPathComponent("cloud.json")
    guard FileManager.default.fileExists(atPath: cloudConfig.path) else {
      return
    }

    // Existing private-beta installs may still have the old npm-backed
    // connector loaded. The controlled migration stops it only after this
    // bundled replacement has been built and verified, preventing two sockets
    // from claiming the same paired host identity.
    guard !Self.managedServiceIsLoaded(label: Self.legacyCloudServiceLabel) else {
      return
    }

    do {
      status("Connecting paired ClawDad devices...")
      try startManagedCloudHost(port: port, configURL: cloudConfig)
    } catch {
      appendNativeCloudHostDiagnostic(error.localizedDescription)
    }
  }

  private func startManagedCloudHost(port: Int, configURL: URL) throws {
    let serverPath = repoRoot.appendingPathComponent("lib/server.mjs")
    guard FileManager.default.fileExists(atPath: serverPath.path) else {
      throw NSError(
        domain: "ClawDad",
        code: 7,
        userInfo: [NSLocalizedDescriptionKey: "Could not find \(serverPath.path)"]
      )
    }
    let nodeURL = try Self.nodeExecutableURL(repoRoot: repoRoot)
    let logsDir = supportDir.appendingPathComponent("logs")
    try FileManager.default.createDirectory(at: logsDir, withIntermediateDirectories: true)
    let stdout = logsDir.appendingPathComponent("native-cloud-host.stdout.log")
    let stderr = logsDir.appendingPathComponent("native-cloud-host.stderr.log")
    FileManager.default.createFile(atPath: stdout.path, contents: nil)
    FileManager.default.createFile(atPath: stderr.path, contents: nil)

    let environment = Self.serverEnvironment(
      repoRoot: repoRoot,
      tokenFile: tokenFile
    )
    let process = Process()
    process.executableURL = nodeURL
    process.arguments = [
      serverPath.path,
      "cloud-host",
      "--config", configURL.path,
      "--local-url", baseURL(port: port).absoluteString,
      "--local-token-file", tokenFile.path
    ]
    process.currentDirectoryURL = repoRoot
    process.environment = environment.merging([
      "CLAWDAD_NATIVE_RUNTIME_VERSION": runtimeVersion
    ]) { _, replacement in replacement }
    let cloudStdoutHandle = try FileHandle(forWritingTo: stdout)
    let cloudStderrHandle = try FileHandle(forWritingTo: stderr)
    try cloudStdoutHandle.seekToEnd()
    try cloudStderrHandle.seekToEnd()
    process.standardOutput = cloudStdoutHandle
    process.standardError = cloudStderrHandle
    try process.run()
    try? cloudStdoutHandle.close()
    try? cloudStderrHandle.close()
    processLock.lock()
    managedCloudHostProcess = process
    processLock.unlock()
  }

  private func appendNativeCloudHostDiagnostic(_ message: String) {
    let logURL = supportDir
      .appendingPathComponent("logs", isDirectory: true)
      .appendingPathComponent("native-cloud-host.stderr.log")
    let line = "[native-cloud-host] \(ISO8601DateFormatter().string(from: Date())) \(message)\n"
    guard let data = line.data(using: .utf8) else {
      return
    }
    if !FileManager.default.fileExists(atPath: logURL.path) {
      FileManager.default.createFile(atPath: logURL.path, contents: data)
      return
    }
    guard let handle = try? FileHandle(forWritingTo: logURL) else {
      return
    }
    defer { try? handle.close() }
    _ = try? handle.seekToEnd()
    try? handle.write(contentsOf: data)
  }

  private static func nodeExecutableURL(repoRoot: URL) throws -> URL {
    var candidates: [String] = []
    if let envNode = ProcessInfo.processInfo.environment["CLAWDAD_NODE_PATH"], !envNode.isEmpty {
      candidates.append(envNode)
    }
    candidates.append(contentsOf: [
      repoRoot.appendingPathComponent("bin/node").path,
      "/opt/homebrew/bin/node",
      "/usr/local/bin/node",
      "/usr/bin/node"
    ])

    for candidate in candidates {
      if FileManager.default.isExecutableFile(atPath: candidate) {
        return URL(fileURLWithPath: candidate)
      }
    }

    throw NSError(
      domain: "ClawDad",
      code: 4,
      userInfo: [
        NSLocalizedDescriptionKey:
          "ClawDad's managed Node runtime is missing. Reinstall ClawDad or set CLAWDAD_NODE_PATH to a compatible node executable."
      ]
    )
  }

  private static func serverEnvironment(repoRoot: URL, tokenFile: URL) -> [String: String] {
    var environment = ProcessInfo.processInfo.environment
    let home = FileManager.default.homeDirectoryForCurrentUser
    let pathEntries = [
      repoRoot.appendingPathComponent("bin").path,
      repoRoot.appendingPathComponent("node_modules/.bin").path,
      home.appendingPathComponent(".local/bin").path,
      "/opt/homebrew/bin",
      "/usr/local/bin",
      "/usr/bin",
      "/bin",
      "/usr/sbin",
      "/sbin"
    ]
    let existingPath = environment["PATH"] ?? ""
    environment["PATH"] = (pathEntries + (existingPath.isEmpty ? [] : [existingPath]))
      .joined(separator: ":")
    environment["CLAWDAD_ROOT"] = repoRoot.path
    environment["CLAWDAD_SERVER_TOKEN_FILE"] = tokenFile.path
    environment["CLAWDAD_DISABLE_DELEGATE_SUPERVISOR_RESUME"] = "1"
    environment["CLAWDAD_DISABLE_QUEUED_DISPATCH_RESUME"] = "1"
    let codexHome = environment["CODEX_HOME"]?.trimmingCharacters(
      in: .whitespacesAndNewlines
    ) ?? ""
    let sharedCodexHome = codexHome.isEmpty
      ? home.appendingPathComponent(".codex", isDirectory: true).path
      : codexHome
    environment["CODEX_HOME"] = sharedCodexHome
    environment["CLAWDAD_CODEX_HOME"] = sharedCodexHome
    let bundledOrp = repoRoot.appendingPathComponent("node_modules/.bin/orp")
    if FileManager.default.isExecutableFile(atPath: bundledOrp.path) {
      environment["CLAWDAD_ORP"] = bundledOrp.path
    }
    return environment
  }

  private static func launchEnvironmentArguments(
    _ environment: [String: String],
    extra: [String: String] = [:]
  ) -> [String] {
    let keys = [
      "PATH",
      "CLAWDAD_ROOT",
      "CLAWDAD_SERVER_TOKEN_FILE",
      "CLAWDAD_DISABLE_DELEGATE_SUPERVISOR_RESUME",
      "CLAWDAD_DISABLE_QUEUED_DISPATCH_RESUME",
      "CLAWDAD_ORP",
      "CLAWDAD_CODEX",
      "CLAWDAD_CODEX_HOME",
      "CODEX_HOME"
    ]
    var values = keys.compactMap { key -> String? in
      guard let value = environment[key], !value.isEmpty else {
        return nil
      }
      return "\(key)=\(value)"
    }
    values.append(contentsOf: extra.keys.sorted().compactMap { key in
      guard let value = extra[key], !value.isEmpty else {
        return nil
      }
      return "\(key)=\(value)"
    })
    return values
  }

  private static func removeManagedService(label: String) {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/bin/launchctl")
    process.arguments = ["remove", label]
    process.standardOutput = FileHandle.nullDevice
    process.standardError = FileHandle.nullDevice
    do {
      try process.run()
      process.waitUntilExit()
    } catch {
      return
    }
    waitForManagedServiceRemoval(label: label)
  }

  private static func waitForManagedServiceRemoval(label: String) {
    let deadline = Date().addingTimeInterval(2)
    var consecutiveAbsentChecks = 0
    while Date() < deadline {
      if managedServiceIsLoaded(label: label) {
        consecutiveAbsentChecks = 0
      } else {
        consecutiveAbsentChecks += 1
        if consecutiveAbsentChecks >= 2 {
          return
        }
      }
      Thread.sleep(forTimeInterval: 0.1)
    }
  }

  private static func managedServiceIsLoaded(label: String) -> Bool {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/bin/launchctl")
    process.arguments = ["list", label]
    process.standardOutput = FileHandle.nullDevice
    process.standardError = FileHandle.nullDevice
    do {
      try process.run()
      process.waitUntilExit()
      return process.terminationStatus == 0
    } catch {
      return false
    }
  }

  private func waitForHealth(port: Int, status: @escaping (String) -> Void) throws {
    let deadline = Date().addingTimeInterval(20)
    while Date() < deadline {
      if let health = health(port: port), health.ok, health.service == "clawdad-server" {
        return
      }
      status("Waiting for ClawDad service...")
      Thread.sleep(forTimeInterval: 0.35)
    }
    throw NSError(
      domain: "ClawDad",
      code: 3,
      userInfo: [NSLocalizedDescriptionKey: "ClawDad service did not become ready. Check \(supportDir.appendingPathComponent("logs").path)."]
    )
  }

  private static func applicationSupportDir() throws -> URL {
    let base = try FileManager.default.url(
      for: .applicationSupportDirectory,
      in: .userDomainMask,
      appropriateFor: nil,
      create: true
    )
    return base.appendingPathComponent(appName, isDirectory: true)
  }

  private static func prepareBundledRuntime(
    _ discoveredRoot: URL,
    supportDir: URL
  ) throws -> URL {
    guard let resources = Bundle.main.resourceURL else {
      return discoveredRoot
    }
    let bundledRoot = resources
      .appendingPathComponent("runtime", isDirectory: true)
      .standardizedFileURL
    guard discoveredRoot.standardizedFileURL.path == bundledRoot.path else {
      return discoveredRoot
    }

    let fileManager = FileManager.default
    try fileManager.createDirectory(
      at: supportDir,
      withIntermediateDirectories: true
    )
    let runtimeRoot = supportDir.appendingPathComponent(
      "runtime",
      isDirectory: true
    )
    let sourceMarker = bundledRoot.appendingPathComponent(".bundle-version")
    let installedMarker = runtimeRoot.appendingPathComponent(".bundle-version")
    let sourceVersion = try String(
      contentsOf: sourceMarker,
      encoding: .utf8
    ).trimmingCharacters(in: .whitespacesAndNewlines)
    let installedVersion = (
      try? String(contentsOf: installedMarker, encoding: .utf8)
        .trimmingCharacters(in: .whitespacesAndNewlines)
    ) ?? ""

    if !sourceVersion.isEmpty,
       sourceVersion == installedVersion,
       runtimeRootIsValid(runtimeRoot) {
      return runtimeRoot
    }

    let stagingRoot = supportDir.appendingPathComponent(
      ".runtime-\(UUID().uuidString.lowercased())",
      isDirectory: true
    )
    do {
      try fileManager.copyItem(at: bundledRoot, to: stagingRoot)
      if fileManager.fileExists(atPath: runtimeRoot.path) {
        try fileManager.removeItem(at: runtimeRoot)
      }
      try fileManager.moveItem(at: stagingRoot, to: runtimeRoot)
    } catch {
      try? fileManager.removeItem(at: stagingRoot)
      throw error
    }

    guard runtimeRootIsValid(runtimeRoot) else {
      throw NSError(
        domain: "ClawDad",
        code: 5,
        userInfo: [
          NSLocalizedDescriptionKey:
            "ClawDad could not prepare its bundled runtime."
        ]
      )
    }
    return runtimeRoot
  }

  private static func runtimeRootIsValid(_ root: URL) -> Bool {
    let package = root.appendingPathComponent("package.json")
    let server = root.appendingPathComponent("lib/server.mjs")
    let node = root.appendingPathComponent("bin/node")
    let orp = root.appendingPathComponent("node_modules/.bin/orp")
    return FileManager.default.fileExists(atPath: package.path)
      && FileManager.default.fileExists(atPath: server.path)
      && FileManager.default.isExecutableFile(atPath: node.path)
      && FileManager.default.isExecutableFile(atPath: orp.path)
  }

  private static func runtimeVersion(for root: URL) -> String {
    let marker = root.appendingPathComponent(".bundle-version")
    if let value = try? String(contentsOf: marker, encoding: .utf8)
      .trimmingCharacters(in: .whitespacesAndNewlines),
       !value.isEmpty {
      return value
    }

    let files = [
      root.appendingPathComponent("lib/server.mjs"),
      root.appendingPathComponent("web/index.html"),
      root.appendingPathComponent("web/app.js")
    ]
    let fingerprints = files.compactMap { file -> String? in
      guard let attributes = try? FileManager.default.attributesOfItem(
        atPath: file.path
      ) else {
        return nil
      }
      let size = (attributes[.size] as? NSNumber)?.uint64Value ?? 0
      let modified = (
        attributes[.modificationDate] as? Date
      )?.timeIntervalSince1970 ?? 0
      return "\(size)-\(Int(modified * 1000))"
    }
    return "development-\(fingerprints.joined(separator: "-"))"
  }

  private static func findRepoRoot() -> URL? {
    var candidates: [URL] = []
    if let envRoot = ProcessInfo.processInfo.environment["CLAWDAD_ROOT"], !envRoot.isEmpty {
      candidates.append(URL(fileURLWithPath: envRoot, isDirectory: true))
    }
    if let resources = Bundle.main.resourceURL {
      candidates.append(resources.appendingPathComponent("runtime", isDirectory: true))
    }
    candidates.append(URL(fileURLWithPath: FileManager.default.currentDirectoryPath, isDirectory: true))
    candidates.append(Bundle.main.bundleURL)

    for candidate in candidates {
      var current = candidate
      for _ in 0..<10 {
        let package = current.appendingPathComponent("package.json")
        let server = current.appendingPathComponent("lib/server.mjs")
        if FileManager.default.fileExists(atPath: package.path),
           FileManager.default.fileExists(atPath: server.path),
           let data = try? Data(contentsOf: package),
           let text = String(data: data, encoding: .utf8),
           text.contains("\"name\": \"clawdad\"") {
          return current
        }
        let parent = current.deletingLastPathComponent()
        if parent.path == current.path {
          break
        }
        current = parent
      }
    }
    return nil
  }
}

final class AppDelegate: NSObject, NSApplicationDelegate, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate {
  private var window: NSWindow!
  private var statusLabel: NSTextField!
  private var webView: WKWebView?
  private var service: ClawDadService?
  private var systemReadiness: MacSystemReadiness?
  private var remoteAssistHost: RemoteAssistHost?
  private var remoteComputerManager: MacRemoteComputerManager?
  private var remoteAssistClient: MacRemoteAssistClient?
  private var remoteAssistWindowController: MacRemoteAssistWindowController?
  private var remoteAssistIndicator: NSPanel?
  private var nativeInstanceGuard: NativeAppInstanceGuard?
  private let updateController = ClawDadUpdateController()

  func applicationDidFinishLaunching(_ notification: Notification) {
    let nativeInstanceGuard = NativeAppInstanceGuard()
    self.nativeInstanceGuard = nativeInstanceGuard
    nativeInstanceGuard.acquire { [weak self] outcome in
      guard let self else {
        return
      }
      switch outcome {
      case .launch:
        self.finishApplicationLaunch()
      case .exit:
        NSApp.terminate(nil)
      case .blocked(let message):
        let alert = NSAlert()
        alert.messageText = "ClawDad could not become the active Mac app."
        alert.informativeText = message
        alert.alertStyle = .warning
        alert.runModal()
        NSApp.terminate(nil)
      }
    }
  }

  private func finishApplicationLaunch() {
    NSApp.setActivationPolicy(.regular)
    buildApplicationMenu()
    buildWindow()
    showLaunchScreen("Starting ClawDad...")
    startRemoteAssistHost()
    startRemoteComputerManager()
    startService()
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
    NativeAppLifecyclePolicy.terminatesAfterLastWindowClosed
  }

  func applicationShouldHandleReopen(
    _ sender: NSApplication,
    hasVisibleWindows _: Bool
  ) -> Bool {
    if NativeAppLifecyclePolicy.shouldRestoreMainWindow(
      isVisible: window?.isVisible == true
    ) {
      window?.makeKeyAndOrderFront(nil)
      sender.activate(ignoringOtherApps: true)
    }
    return true
  }

  func applicationWillTerminate(_ notification: Notification) {
    remoteAssistWindowController?.closeSession()
    remoteComputerManager?.stop()
    remoteAssistHost?.stop()
    service?.stop()
  }

  private func startRemoteAssistHost() {
    let host = RemoteAssistHost()
    host.onStatusChange = { [weak self] status in
      self?.updateRemoteAssistStatus(status)
    }
    remoteAssistHost = host
    host.startIfEnabled()
  }

  private func startRemoteComputerManager() {
    let manager = MacRemoteComputerManager()
    manager.onChange = { [weak self] in
      self?.publishRemoteComputerStatus()
    }
    remoteComputerManager = manager
  }

  private func buildWindow() {
    window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 920, height: 980),
      styleMask: [.titled, .closable, .miniaturizable, .resizable],
      backing: .buffered,
      defer: false
    )
    window.title = appName
    window.minSize = NSSize(width: 420, height: 640)
    window.isReleasedWhenClosed = false
    window.center()
    window.makeKeyAndOrderFront(nil)
    NSApp.activate(ignoringOtherApps: true)
  }

  private func buildApplicationMenu() {
    let mainMenu = NSMenu()
    let appMenuItem = NSMenuItem()
    let appMenu = NSMenu()

    appMenu.addItem(
      withTitle: "About \(appName)",
      action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)),
      keyEquivalent: ""
    )
    let updateItem = NSMenuItem(
      title: "Check for Updates...",
      action: #selector(ClawDadUpdateController.checkForUpdates(_:)),
      keyEquivalent: ""
    )
    updateItem.target = updateController
    appMenu.addItem(updateItem)
    appMenu.addItem(.separator())
    appMenu.addItem(
      withTitle: "Quit \(appName)",
      action: #selector(NSApplication.terminate(_:)),
      keyEquivalent: "q"
    )

    appMenuItem.submenu = appMenu
    mainMenu.addItem(appMenuItem)
    NSApp.mainMenu = mainMenu
  }

  private func showLaunchScreen(_ text: String) {
    let view = NSView(frame: window.contentView?.bounds ?? .zero)
    view.wantsLayer = true
    view.layer?.backgroundColor = NSColor(calibratedRed: 0.07, green: 0.0, blue: 0.0, alpha: 1).cgColor

    let title = NSTextField(labelWithString: appName)
    title.font = NSFont.systemFont(ofSize: 34, weight: .heavy)
    title.textColor = NSColor(calibratedRed: 1.0, green: 0.91, blue: 0.76, alpha: 1)
    title.alignment = .center

    statusLabel = NSTextField(labelWithString: text)
    statusLabel.font = NSFont.monospacedSystemFont(ofSize: 12, weight: .semibold)
    statusLabel.textColor = NSColor(calibratedRed: 0.96, green: 0.74, blue: 0.56, alpha: 1)
    statusLabel.alignment = .center

    let stack = NSStackView(views: [title, statusLabel])
    stack.orientation = .vertical
    stack.spacing = 12
    stack.alignment = .centerX
    stack.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(stack)
    NSLayoutConstraint.activate([
      stack.centerXAnchor.constraint(equalTo: view.centerXAnchor),
      stack.centerYAnchor.constraint(equalTo: view.centerYAnchor)
    ])
    window.contentView = view
  }

  private func updateStatus(_ text: String) {
    DispatchQueue.main.async {
      self.statusLabel?.stringValue = text
    }
  }

  private func startService() {
    do {
      let service = try ClawDadService()
      self.service = service
      self.systemReadiness = MacSystemReadiness(
        repoRoot: service.repoRoot,
        supportDir: service.supportDir
      )
      service.start(status: updateStatus) { result in
        DispatchQueue.main.async {
          switch result {
          case .success(let url):
            self.loadApp(baseURL: url, service: service)
          case .failure(let error):
            self.showLaunchScreen(error.localizedDescription)
          }
        }
      }
    } catch {
      showLaunchScreen(error.localizedDescription)
    }
  }

  private func loadApp(baseURL: URL, service: ClawDadService) {
    updateStatus("Opening ClawDad...")
    let configuration = WKWebViewConfiguration()
    configuration.applicationNameForUserAgent = "ClawDadNative/0.1"
    configuration.userContentController.add(self, name: "clawdadNative")

    let webView = WKWebView(frame: .zero, configuration: configuration)
    webView.navigationDelegate = self
    webView.uiDelegate = self
    webView.allowsBackForwardNavigationGestures = true
    self.webView = webView
    window.contentView = webView
    webView.load(service.authenticatedRequest(for: baseURL))
  }

  @available(macOS 12.0, *)
  func webView(
    _ webView: WKWebView,
    requestMediaCapturePermissionFor origin: WKSecurityOrigin,
    initiatedByFrame frame: WKFrameInfo,
    type: WKMediaCaptureType,
    decisionHandler: @escaping (WKPermissionDecision) -> Void
  ) {
    guard origin.protocol == "http",
          ["127.0.0.1", "localhost"].contains(origin.host),
          type == .microphone || type == .cameraAndMicrophone else {
      decisionHandler(.deny)
      return
    }
    decisionHandler(.grant)
  }

  func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
    guard message.name == "clawdadNative",
          let body = message.body as? [String: Any],
          let id = body["id"] as? String,
          let method = body["method"] as? String else {
      return
    }
    let params = body["params"] as? [String: Any] ?? [:]
    switch method {
    case "getCapabilities":
      resolveNativeMessage(id: id, result: [
        "platform": "macos",
        "chooseFolder": true,
        "remoteAssist": true,
        "remoteComputers": true,
        "systemReadiness": true,
        "updates": true,
        "diagnostics": true
      ])
    case "getSystemReadiness":
      guard let systemReadiness else {
        resolveNativeMessage(id: id, error: "System readiness is unavailable.")
        return
      }
      systemReadiness.status(
        forceCodexUpdateCheck: params["forceCodexUpdateCheck"] as? Bool ?? false
      ) { [weak self] status in
        self?.resolveNativeMessage(id: id, result: status)
      }
    case "setComputerRole":
      guard let systemReadiness else {
        resolveNativeMessage(id: id, error: "System readiness is unavailable.")
        return
      }
      do {
        try systemReadiness.setRole(params["role"] as? String ?? "")
        systemReadiness.status { [weak self] status in
          self?.resolveNativeMessage(id: id, result: status)
        }
      } catch {
        resolveNativeMessage(id: id, error: error.localizedDescription)
      }
    case "installCodex":
      guard let systemReadiness else {
        resolveNativeMessage(id: id, error: "System readiness is unavailable.")
        return
      }
      do {
        try systemReadiness.startCodexInstall()
        resolveNativeMessage(id: id, result: ["started": true])
      } catch {
        resolveNativeMessage(id: id, error: error.localizedDescription)
      }
    case "openCodexLogin":
      guard let systemReadiness else {
        resolveNativeMessage(id: id, error: "System readiness is unavailable.")
        return
      }
      do {
        try systemReadiness.openCodexLogin()
        resolveNativeMessage(id: id, result: ["opened": true])
      } catch {
        resolveNativeMessage(id: id, error: error.localizedDescription)
      }
    case "reauthenticateCodex":
      guard let systemReadiness else {
        resolveNativeMessage(id: id, error: "System readiness is unavailable.")
        return
      }
      do {
        try systemReadiness.openCodexLogin(resetCredentials: true)
        resolveNativeMessage(id: id, result: ["opened": true])
      } catch {
        resolveNativeMessage(id: id, error: error.localizedDescription)
      }
    case "completeSystemSetup":
      guard let systemReadiness else {
        resolveNativeMessage(id: id, error: "System readiness is unavailable.")
        return
      }
      systemReadiness.complete { [weak self] result in
        switch result {
        case .success(let status):
          self?.resolveNativeMessage(id: id, result: status)
        case .failure(let error):
          self?.resolveNativeMessage(id: id, error: error.localizedDescription)
        }
      }
    case "chooseFolder":
      chooseFolder(id: id, params: params)
    case "getRemoteAssistStatus":
      resolveNativeMessage(
        id: id,
        result: remoteAssistHost?.status.dictionary ?? [:]
      )
    case "setRemoteAssistEnabled":
      guard let enabled = params["enabled"] as? Bool else {
        resolveNativeMessage(id: id, error: "enabled must be true or false")
        return
      }
      remoteAssistHost?.setEnabled(enabled, requestPermissions: enabled)
      resolveNativeMessage(
        id: id,
        result: remoteAssistHost?.status.dictionary ?? [:]
      )
    case "requestRemoteAssistPermissions":
      remoteAssistHost?.requestSystemPermissions()
      resolveNativeMessage(
        id: id,
        result: remoteAssistHost?.status.dictionary ?? [:]
      )
    case "openRemoteAssistPrivacy":
      remoteAssistHost?.openPrivacySettings(
        params["pane"] as? String ?? "screen"
      )
      resolveNativeMessage(
        id: id,
        result: remoteAssistHost?.status.dictionary ?? [:]
      )
    case "stopRemoteAssist":
      remoteAssistHost?.stopActiveSession()
      resolveNativeMessage(
        id: id,
        result: remoteAssistHost?.status.dictionary ?? [:]
      )
    case "getRemoteComputers":
      resolveNativeMessage(
        id: id,
        result: remoteComputerManager?.statusDictionary ?? [
          "computers": [],
          "connected": false,
          "hostOnline": false,
          "activeComputerId": "",
          "state": "Unavailable"
        ]
      )
    case "pairRemoteComputer":
      let code = params["code"] as? String ?? ""
      guard !code.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
            let manager = remoteComputerManager else {
        resolveNativeMessage(id: id, error: "Paste a ClawDad pairing code from the other computer.")
        return
      }
      Task { @MainActor [weak self] in
        do {
          let profile = try await manager.pair(code: code)
          self?.resolveNativeMessage(id: id, result: [
            "paired": true,
            "computer": profile.dictionary,
            "status": manager.statusDictionary
          ])
        } catch is CancellationError {
          self?.resolveNativeMessage(id: id, error: "Pairing was cancelled.")
        } catch {
          self?.resolveNativeMessage(id: id, error: error.localizedDescription)
        }
      }
    case "openRemoteComputer":
      let computerId = params["computerId"] as? String ?? ""
      do {
        try openRemoteComputer(computerId: computerId)
        resolveNativeMessage(id: id, result: ["opened": true])
      } catch {
        resolveNativeMessage(id: id, error: error.localizedDescription)
      }
    case "forgetRemoteComputer":
      let computerId = params["computerId"] as? String ?? ""
      do {
        try remoteComputerManager?.forget(computerId: computerId)
        resolveNativeMessage(
          id: id,
          result: remoteComputerManager?.statusDictionary ?? [:]
        )
      } catch {
        resolveNativeMessage(id: id, error: error.localizedDescription)
      }
    case "getDesktopAppStatus":
      resolveNativeMessage(id: id, result: desktopAppStatus())
    case "checkForUpdates":
      updateController.checkForUpdates(nil)
      resolveNativeMessage(id: id, result: desktopAppStatus())
    case "openLogs":
      openLogs()
      resolveNativeMessage(id: id, result: ["opened": true])
    case "copyDiagnostics":
      resolveNativeMessage(id: id, result: [
        "text": diagnosticsText()
      ])
    default:
      resolveNativeMessage(id: id, error: "Unsupported native method: \(method)")
    }
  }

  private func chooseFolder(id: String, params: [String: Any]) {
    let panel = NSOpenPanel()
    panel.title = titleForFolderPurpose(params["purpose"] as? String)
    panel.prompt = "Use This Folder"
    panel.canChooseFiles = false
    panel.canChooseDirectories = true
    panel.allowsMultipleSelection = false
    panel.canCreateDirectories = true
    if let path = params["defaultPath"] as? String, !path.isEmpty {
      panel.directoryURL = URL(fileURLWithPath: path, isDirectory: true)
    }
    panel.beginSheetModal(for: window) { response in
      if response == .OK, let url = panel.url {
        self.resolveNativeMessage(id: id, result: [
          "path": url.path,
          "cancelled": false
        ])
      } else {
        self.resolveNativeMessage(id: id, result: [
          "cancelled": true
        ])
      }
    }
  }

  private func titleForFolderPurpose(_ purpose: String?) -> String {
    switch purpose {
    case "setup":
      return "Choose Projects Folder"
    case "scratchpad":
      return "Choose Scratchpad Focus"
    default:
      return "Choose Project Folder"
    }
  }

  private func desktopAppStatus() -> [String: Any] {
    let bundle = Bundle.main
    var status: [String: Any] = [
      "platform": "macos",
      "architecture": nativeArchitecture,
      "version": bundle.object(
        forInfoDictionaryKey: "CFBundleShortVersionString"
      ) as? String ?? "development",
      "build": bundle.object(
        forInfoDictionaryKey: "CFBundleVersion"
      ) as? String ?? "",
      "runtimeVersion": service?.runtimeVersion ?? "",
      "serviceReady": service != nil,
      "logsAvailable": service != nil
    ]
    status["updates"] = updateController.statusDictionary
    return status
  }

  private func openLogs() {
    guard let logsURL = service?.supportDir.appendingPathComponent(
      "logs",
      isDirectory: true
    ) else {
      return
    }
    try? FileManager.default.createDirectory(
      at: logsURL,
      withIntermediateDirectories: true
    )
    NSWorkspace.shared.open(logsURL)
  }

  private func diagnosticsText() -> String {
    let appStatus = desktopAppStatus()
    let remoteStatus = remoteAssistHost?.status
    let lines = [
      "ClawDad Desktop Diagnostics",
      "App: \(appStatus["version"] ?? "") (\(appStatus["build"] ?? ""))",
      "Runtime: \(appStatus["runtimeVersion"] ?? "")",
      "macOS: \(ProcessInfo.processInfo.operatingSystemVersionString)",
      "Architecture: \(nativeArchitecture)",
      "Service ready: \((appStatus["serviceReady"] as? Bool) == true ? "yes" : "no")",
      "Remote Assist enabled: \(remoteStatus?.enabled == true ? "yes" : "no")",
      "Remote Assist paired devices: \(remoteStatus?.pairedDeviceCount ?? 0)",
      "Screen Recording: \(remoteStatus?.screenRecordingGranted == true ? "allowed" : "required")",
      "Control Access: \(remoteStatus?.accessibilityGranted == true ? "allowed" : "required")",
      "Relay connected: \(remoteStatus?.relayConnected == true ? "yes" : "no")",
      "Remote session active: \(remoteStatus?.active == true ? "yes" : "no")",
      "Paired computers available to control: \(remoteComputerManager?.profiles.count ?? 0)",
      "Remote computer connection: \(remoteComputerManager?.connectionState.label ?? "unavailable")"
    ]
    return lines.joined(separator: "\n")
  }

  private func resolveNativeMessage(id: String, result: [String: Any] = [:], error: String? = nil) {
    var payload: [String: Any] = [
      "id": id,
      "ok": error == nil,
      "result": result
    ]
    if let error {
      payload["error"] = error
    }
    guard let data = try? JSONSerialization.data(withJSONObject: payload),
          let json = String(data: data, encoding: .utf8) else {
      return
    }
    webView?.evaluateJavaScript("window.ClawDadNative && window.ClawDadNative.__resolve(\(json));")
  }

  private func updateRemoteAssistStatus(_ status: RemoteAssistHostStatus) {
    if status.active {
      showRemoteAssistIndicator()
    } else {
      remoteAssistIndicator?.orderOut(nil)
      remoteAssistIndicator = nil
    }

    guard let data = try? JSONSerialization.data(
      withJSONObject: status.dictionary
    ),
    let json = String(data: data, encoding: .utf8) else {
      return
    }
    webView?.evaluateJavaScript(
      "window.dispatchEvent(new CustomEvent('clawdad-native-remote-assist-status', { detail: \(json) }));"
    )
  }

  private func openRemoteComputer(computerId: String) throws {
    guard let manager = remoteComputerManager,
          let profile = manager.profiles.first(where: { $0.id == computerId }) else {
      throw MacRemoteComputerError.profileNotFound
    }
    guard profile.supportsRemoteAssist else {
      throw MacRemoteComputerError.remoteAssistUnavailable
    }
    remoteAssistWindowController?.closeSession()
    let client = MacRemoteAssistClient(manager: manager)
    let controller = MacRemoteAssistWindowController(
      client: client,
      computer: profile
    )
    controller.onClose = { [weak self, weak controller] in
      guard self?.remoteAssistWindowController === controller else {
        return
      }
      self?.remoteAssistWindowController = nil
      self?.remoteAssistClient = nil
    }
    remoteAssistClient = client
    remoteAssistWindowController = controller
    controller.open()
  }

  private func publishRemoteComputerStatus() {
    guard let status = remoteComputerManager?.statusDictionary,
          let data = try? JSONSerialization.data(withJSONObject: status),
          let json = String(data: data, encoding: .utf8) else {
      return
    }
    webView?.evaluateJavaScript(
      "window.dispatchEvent(new CustomEvent('clawdad-native-remote-computers-status', { detail: \(json) }));"
    )
  }

  private func showRemoteAssistIndicator() {
    if let remoteAssistIndicator {
      positionRemoteAssistIndicator(remoteAssistIndicator)
      remoteAssistIndicator.orderFrontRegardless()
      return
    }

    let panel = NSPanel(
      contentRect: NSRect(x: 0, y: 0, width: 330, height: 64),
      styleMask: [.nonactivatingPanel, .hudWindow],
      backing: .buffered,
      defer: false
    )
    panel.level = .floating
    panel.isOpaque = false
    panel.backgroundColor = .clear
    panel.hasShadow = true
    panel.hidesOnDeactivate = false
    panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]

    let effect = NSVisualEffectView(frame: panel.contentView?.bounds ?? .zero)
    effect.material = .hudWindow
    effect.blendingMode = .behindWindow
    effect.state = .active
    effect.wantsLayer = true
    effect.layer?.cornerRadius = 12
    effect.translatesAutoresizingMaskIntoConstraints = false

    let icon = NSImageView()
    icon.image = NSImage(
      systemSymbolName: "iphone.radiowaves.left.and.right",
      accessibilityDescription: "Remote Assist"
    )
    icon.contentTintColor = .systemGreen
    icon.translatesAutoresizingMaskIntoConstraints = false

    let label = NSTextField(labelWithString: "Remote Assist active")
    label.font = NSFont.systemFont(ofSize: 14, weight: .semibold)
    label.textColor = .labelColor

    let stopButton = NSButton(
      title: "Stop",
      target: self,
      action: #selector(stopRemoteAssistFromMac)
    )
    stopButton.bezelStyle = .rounded
    stopButton.keyEquivalent = ""

    let stack = NSStackView(views: [icon, label, stopButton])
    stack.orientation = .horizontal
    stack.alignment = .centerY
    stack.spacing = 12
    stack.translatesAutoresizingMaskIntoConstraints = false

    let content = NSView(frame: panel.contentView?.bounds ?? .zero)
    content.addSubview(effect)
    content.addSubview(stack)
    panel.contentView = content
    NSLayoutConstraint.activate([
      effect.leadingAnchor.constraint(equalTo: content.leadingAnchor),
      effect.trailingAnchor.constraint(equalTo: content.trailingAnchor),
      effect.topAnchor.constraint(equalTo: content.topAnchor),
      effect.bottomAnchor.constraint(equalTo: content.bottomAnchor),
      stack.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 16),
      stack.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -12),
      stack.centerYAnchor.constraint(equalTo: content.centerYAnchor),
      icon.widthAnchor.constraint(equalToConstant: 24),
      icon.heightAnchor.constraint(equalToConstant: 24)
    ])

    remoteAssistIndicator = panel
    positionRemoteAssistIndicator(panel)
    panel.orderFrontRegardless()
  }

  private func positionRemoteAssistIndicator(_ panel: NSPanel) {
    let visibleFrame = NSScreen.main?.visibleFrame
      ?? NSScreen.screens.first?.visibleFrame
      ?? .zero
    panel.setFrameOrigin(NSPoint(
      x: visibleFrame.maxX - panel.frame.width - 24,
      y: visibleFrame.maxY - panel.frame.height - 24
    ))
  }

  @objc private func stopRemoteAssistFromMac() {
    remoteAssistHost?.stopActiveSession()
  }
}

#if arch(arm64)
let nativeArchitecture = "Apple silicon"
#elseif arch(x86_64)
let nativeArchitecture = "Intel"
#else
let nativeArchitecture = "Unknown"
#endif

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
