import AppKit
import Foundation

enum ClawDadComputerRole: String, CaseIterable {
  case controller
  case host
  case both

  var needsLocalCodex: Bool {
    self != .controller
  }

  var label: String {
    switch self {
    case .controller:
      return "Control other computers"
    case .host:
      return "Run Codex on this computer"
    case .both:
      return "Run Codex here and control others"
    }
  }
}

enum MacSystemReadinessPolicy {
  static func canComplete(
    role: ClawDadComputerRole,
    codexInstalled: Bool,
    codexLoggedIn: Bool
  ) -> Bool {
    !role.needsLocalCodex || (codexInstalled && codexLoggedIn)
  }
}

func macCodexCandidatePaths(
  homeDirectory: URL,
  environment: [String: String]
) -> [String] {
  var values: [String] = []
  if let override = environment["CLAWDAD_CODEX"]?.trimmingCharacters(
    in: .whitespacesAndNewlines
  ), !override.isEmpty, override != "codex" {
    values.append(override)
  }
  values.append(contentsOf: [
    homeDirectory.appendingPathComponent(".local/bin/codex").path,
    "/opt/homebrew/bin/codex",
    "/usr/local/bin/codex"
  ])
  var seen = Set<String>()
  return values.filter { seen.insert($0).inserted }
}

private struct MacCapturedCommand {
  var status: Int32
  var output: String
  var timedOut: Bool
}

final class MacSystemReadiness {
  private static let roleKey = "clawdad.setup.role.v1"
  private static let completedKey = "clawdad.setup.completed.v1"
  private static let officialCodexInstaller = URL(
    string: "https://chatgpt.com/codex/install.sh"
  )!

  private let repoRoot: URL
  private let supportDir: URL
  private let defaults: UserDefaults
  private let queue = DispatchQueue(
    label: "earth.frg.ClawDad.system-readiness",
    qos: .userInitiated
  )
  private let stateLock = NSLock()
  private var installState = "idle"
  private var installMessage = ""

  init(
    repoRoot: URL,
    supportDir: URL,
    defaults: UserDefaults = .standard
  ) {
    self.repoRoot = repoRoot
    self.supportDir = supportDir
    self.defaults = defaults
  }

  var role: ClawDadComputerRole {
    get {
      ClawDadComputerRole(
        rawValue: defaults.string(forKey: Self.roleKey) ?? ""
      ) ?? .both
    }
    set {
      defaults.set(newValue.rawValue, forKey: Self.roleKey)
      defaults.set(false, forKey: Self.completedKey)
    }
  }

  func setRole(_ value: String) throws {
    guard let next = ClawDadComputerRole(rawValue: value) else {
      throw NSError(
        domain: "ClawDad",
        code: 40,
        userInfo: [NSLocalizedDescriptionKey: "Choose a valid computer role."]
      )
    }
    role = next
  }

  func status(completion: @escaping ([String: Any]) -> Void) {
    queue.async {
      let status = self.statusDictionary()
      DispatchQueue.main.async {
        completion(status)
      }
    }
  }

  func complete(completion: @escaping (Result<[String: Any], Error>) -> Void) {
    queue.async {
      let status = self.statusDictionary()
      guard (status["canComplete"] as? Bool) == true else {
        let error = NSError(
          domain: "ClawDad",
          code: 41,
          userInfo: [
            NSLocalizedDescriptionKey:
              "Install Codex and sign in with ChatGPT before finishing this computer setup."
          ]
        )
        DispatchQueue.main.async {
          completion(.failure(error))
        }
        return
      }
      self.defaults.set(true, forKey: Self.completedKey)
      let completedStatus = self.statusDictionary()
      DispatchQueue.main.async {
        completion(.success(completedStatus))
      }
    }
  }

  func startCodexInstall() throws {
    stateLock.lock()
    defer { stateLock.unlock() }
    guard installState != "installing" else {
      return
    }
    installState = "installing"
    installMessage = "Downloading the official Codex installer from OpenAI..."
    queue.async {
      do {
        try self.installCodex()
        self.updateInstallState(
          state: "installed",
          message: "Codex is installed in ~/.local/bin and available to Terminal and ClawDad."
        )
      } catch {
        self.updateInstallState(
          state: "failed",
          message: error.localizedDescription
        )
      }
    }
  }

  func openCodexLogin() throws {
    guard let codexPath = detectedCodexPath() else {
      throw NSError(
        domain: "ClawDad",
        code: 42,
        userInfo: [NSLocalizedDescriptionKey: "Install Codex before signing in."]
      )
    }
    let loginDir = supportDir.appendingPathComponent(
      "setup",
      isDirectory: true
    )
    try FileManager.default.createDirectory(
      at: loginDir,
      withIntermediateDirectories: true
    )
    let commandURL = loginDir.appendingPathComponent("Sign In to Codex.command")
    let home = FileManager.default.homeDirectoryForCurrentUser
    let codexHome = ProcessInfo.processInfo.environment["CODEX_HOME"]?
      .trimmingCharacters(in: .whitespacesAndNewlines)
    let sharedCodexHome = (codexHome?.isEmpty == false)
      ? codexHome!
      : home.appendingPathComponent(".codex", isDirectory: true).path
    let script = """
    #!/bin/zsh
    export CODEX_HOME=\(shellQuote(sharedCodexHome))
    export PATH=\(shellQuote(home.appendingPathComponent(".local/bin").path + ":/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"))
    clear
    echo "ClawDad Codex sign in"
    echo "Your browser will open so you can sign in with ChatGPT."
    echo
    \(shellQuote(codexPath)) login
    echo
    \(shellQuote(codexPath)) login status
    echo
    echo "You can close this Terminal window and return to ClawDad."
    read -k 1 "?Press any key to close..."
    """
    try script.write(to: commandURL, atomically: true, encoding: .utf8)
    try FileManager.default.setAttributes(
      [.posixPermissions: 0o700],
      ofItemAtPath: commandURL.path
    )
    guard NSWorkspace.shared.open(commandURL) else {
      throw NSError(
        domain: "ClawDad",
        code: 43,
        userInfo: [NSLocalizedDescriptionKey: "Could not open the Codex sign-in window."]
      )
    }
  }

  private func statusDictionary() -> [String: Any] {
    let currentRole = role
    let bundledNode = repoRoot.appendingPathComponent("bin/node")
    let bundledOrp = repoRoot.appendingPathComponent("node_modules/.bin/orp")
    let nodeReady = FileManager.default.isExecutableFile(atPath: bundledNode.path)
    let orpReady = FileManager.default.isExecutableFile(atPath: bundledOrp.path)
    let nodeVersion = nodeReady
      ? capture(bundledNode.path, ["--version"], timeout: 5).output
      : ""
    let codexPath = detectedCodexPath()
    let codexVersion = codexPath.map {
      capture($0, ["--version"], timeout: 8).output
    } ?? ""
    let login = codexPath.map {
      capture($0, ["login", "status"], timeout: 10)
    }
    let codexLoggedIn = login?.status == 0 && login?.timedOut == false
    let state = currentInstallState()
    let completed = defaults.bool(forKey: Self.completedKey)
    let canComplete = nodeReady && orpReady && MacSystemReadinessPolicy.canComplete(
      role: currentRole,
      codexInstalled: codexPath != nil,
      codexLoggedIn: codexLoggedIn
    )
    let home = FileManager.default.homeDirectoryForCurrentUser
    let codexHome = ProcessInfo.processInfo.environment["CODEX_HOME"]?
      .trimmingCharacters(in: .whitespacesAndNewlines)

    return [
      "setupRequired": !completed,
      "completed": completed,
      "role": currentRole.rawValue,
      "roleLabel": currentRole.label,
      "needsLocalCodex": currentRole.needsLocalCodex,
      "canComplete": canComplete,
      "architecture": nativeArchitecture,
      "node": [
        "ready": nodeReady,
        "managed": true,
        "version": nodeVersion,
        "path": bundledNode.path
      ],
      "orp": [
        "ready": orpReady,
        "managed": true,
        "path": bundledOrp.path
      ],
      "codex": [
        "installed": codexPath != nil,
        "path": codexPath ?? "",
        "version": codexVersion,
        "loggedIn": codexLoggedIn,
        "loginStatus": login?.output ?? "",
        "home": (codexHome?.isEmpty == false)
          ? codexHome!
          : home.appendingPathComponent(".codex", isDirectory: true).path,
        "installerUrl": Self.officialCodexInstaller.absoluteString
      ],
      "install": [
        "state": state.state,
        "message": state.message
      ]
    ]
  }

  private func detectedCodexPath() -> String? {
    for candidate in macCodexCandidatePaths(
      homeDirectory: FileManager.default.homeDirectoryForCurrentUser,
      environment: ProcessInfo.processInfo.environment
    ) where FileManager.default.isExecutableFile(atPath: candidate) {
      return candidate
    }
    return nil
  }

  private func installCodex() throws {
    let installerDir = supportDir.appendingPathComponent(
      "installers",
      isDirectory: true
    )
    try FileManager.default.createDirectory(
      at: installerDir,
      withIntermediateDirectories: true
    )
    let installerURL = installerDir.appendingPathComponent("codex-install.sh")
    let semaphore = DispatchSemaphore(value: 0)
    var downloadedData: Data?
    var downloadError: Error?
    URLSession.shared.dataTask(with: Self.officialCodexInstaller) {
      data,
      response,
      error in
      defer { semaphore.signal() }
      if let error {
        downloadError = error
        return
      }
      guard let http = response as? HTTPURLResponse,
            http.statusCode == 200,
            let data,
            data.count > 100 else {
        downloadError = NSError(
          domain: "ClawDad",
          code: 44,
          userInfo: [NSLocalizedDescriptionKey: "OpenAI's Codex installer could not be downloaded."]
        )
        return
      }
      downloadedData = data
    }.resume()
    guard semaphore.wait(timeout: .now() + 60) == .success else {
      throw NSError(
        domain: "ClawDad",
        code: 45,
        userInfo: [NSLocalizedDescriptionKey: "The Codex installer download timed out."]
      )
    }
    if let downloadError {
      throw downloadError
    }
    guard let downloadedData else {
      throw NSError(
        domain: "ClawDad",
        code: 46,
        userInfo: [NSLocalizedDescriptionKey: "The Codex installer download was empty."]
      )
    }
    try downloadedData.write(to: installerURL, options: .atomic)
    try FileManager.default.setAttributes(
      [.posixPermissions: 0o700],
      ofItemAtPath: installerURL.path
    )

    let home = FileManager.default.homeDirectoryForCurrentUser
    var environment = ProcessInfo.processInfo.environment
    environment["CODEX_INSTALL_DIR"] = home.appendingPathComponent(".local/bin").path
    environment["CODEX_HOME"] = environment["CODEX_HOME"] ?? home
      .appendingPathComponent(".codex", isDirectory: true).path
    environment["CODEX_NON_INTERACTIVE"] = "1"
    let result = capture(
      "/bin/sh",
      [installerURL.path],
      timeout: 300,
      environment: environment
    )
    guard !result.timedOut, result.status == 0,
          detectedCodexPath() != nil else {
      let detail = result.output.isEmpty
        ? "The official Codex installer did not complete."
        : result.output
      throw NSError(
        domain: "ClawDad",
        code: 47,
        userInfo: [NSLocalizedDescriptionKey: detail]
      )
    }
  }

  private func updateInstallState(state: String, message: String) {
    stateLock.lock()
    installState = state
    installMessage = message
    stateLock.unlock()
  }

  private func currentInstallState() -> (state: String, message: String) {
    stateLock.lock()
    defer { stateLock.unlock() }
    return (installState, installMessage)
  }

  private func capture(
    _ executable: String,
    _ arguments: [String],
    timeout: TimeInterval,
    environment: [String: String]? = nil
  ) -> MacCapturedCommand {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: executable)
    process.arguments = arguments
    process.environment = environment ?? ProcessInfo.processInfo.environment
    let outputURL = FileManager.default.temporaryDirectory
      .appendingPathComponent("clawdad-command-\(UUID().uuidString).log")
    guard FileManager.default.createFile(
      atPath: outputURL.path,
      contents: nil
    ), let outputHandle = try? FileHandle(forWritingTo: outputURL) else {
      return MacCapturedCommand(
        status: 126,
        output: "ClawDad could not create a temporary command log.",
        timedOut: false
      )
    }
    defer {
      try? outputHandle.close()
      try? FileManager.default.removeItem(at: outputURL)
    }
    process.standardOutput = outputHandle
    process.standardError = outputHandle
    do {
      try process.run()
    } catch {
      return MacCapturedCommand(
        status: 127,
        output: error.localizedDescription,
        timedOut: false
      )
    }
    let deadline = Date().addingTimeInterval(timeout)
    while process.isRunning && Date() < deadline {
      Thread.sleep(forTimeInterval: 0.05)
    }
    let timedOut = process.isRunning
    if timedOut {
      process.terminate()
    }
    process.waitUntilExit()
    try? outputHandle.synchronize()
    let output = (try? String(contentsOf: outputURL, encoding: .utf8))?
      .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    return MacCapturedCommand(
      status: timedOut ? 124 : process.terminationStatus,
      output: output,
      timedOut: timedOut
    )
  }

  private func shellQuote(_ value: String) -> String {
    "'\(value.replacingOccurrences(of: "'", with: "'\\''"))'"
  }
}
