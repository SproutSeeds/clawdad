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

struct MacCodexSemanticVersion: Equatable, Comparable {
  let major: Int
  let minor: Int
  let patch: Int
  let prerelease: [String]

  init?(extracting value: String) {
    let pattern = #"(?<![0-9])([0-9]+)\.([0-9]+)\.([0-9]+)(?:-([0-9A-Za-z.-]+))?"#
    guard let expression = try? NSRegularExpression(pattern: pattern),
          let match = expression.firstMatch(
            in: value,
            range: NSRange(value.startIndex..., in: value)
          ),
          let majorRange = Range(match.range(at: 1), in: value),
          let minorRange = Range(match.range(at: 2), in: value),
          let patchRange = Range(match.range(at: 3), in: value),
          let major = Int(value[majorRange]),
          let minor = Int(value[minorRange]),
          let patch = Int(value[patchRange]) else {
      return nil
    }

    self.major = major
    self.minor = minor
    self.patch = patch
    if match.range(at: 4).location != NSNotFound,
       let prereleaseRange = Range(match.range(at: 4), in: value) {
      self.prerelease = value[prereleaseRange].split(separator: ".").map(String.init)
    } else {
      self.prerelease = []
    }
  }

  var normalized: String {
    let release = "\(major).\(minor).\(patch)"
    return prerelease.isEmpty ? release : "\(release)-\(prerelease.joined(separator: "."))"
  }

  static func < (lhs: Self, rhs: Self) -> Bool {
    let lhsCore = [lhs.major, lhs.minor, lhs.patch]
    let rhsCore = [rhs.major, rhs.minor, rhs.patch]
    if lhsCore != rhsCore {
      return lhsCore.lexicographicallyPrecedes(rhsCore)
    }
    if lhs.prerelease.isEmpty {
      return false
    }
    if rhs.prerelease.isEmpty {
      return true
    }

    for (left, right) in zip(lhs.prerelease, rhs.prerelease) where left != right {
      let leftNumber = Int(left)
      let rightNumber = Int(right)
      switch (leftNumber, rightNumber) {
      case let (.some(leftValue), .some(rightValue)):
        return leftValue < rightValue
      case (.some, .none):
        return true
      case (.none, .some):
        return false
      case (.none, .none):
        return left < right
      }
    }
    return lhs.prerelease.count < rhs.prerelease.count
  }
}

func macCodexNormalizedVersion(_ value: String) -> String? {
  MacCodexSemanticVersion(extracting: value)?.normalized
}

func macCodexUpdateAvailable(
  installedVersion: String,
  latestReleaseTag: String
) -> Bool? {
  guard let installed = MacCodexSemanticVersion(extracting: installedVersion),
        let latest = MacCodexSemanticVersion(extracting: latestReleaseTag) else {
    return nil
  }
  return installed < latest
}

func macCodexLatestVersion(from releaseData: Data) -> String? {
  guard let value = try? JSONSerialization.jsonObject(with: releaseData),
        let object = value as? [String: Any],
        let tag = object["tag_name"] as? String else {
    return nil
  }
  return macCodexNormalizedVersion(tag)
}

func macCodexAuthenticationNeedsSignIn(
  status: Int32,
  output: String,
  timedOut: Bool = false
) -> Bool {
  if timedOut || status != 0 {
    return true
  }
  let value = output.lowercased()
  return value.contains("refresh token was already used") ||
    value.contains("access token could not be refreshed") ||
    value.contains("authentication failed") ||
    value.contains("authentication required") ||
    value.contains("invalid refresh token") ||
    value.contains("expired refresh token") ||
    value.contains("sign in again") ||
    value.contains("log in again")
}

private struct MacCapturedCommand {
  var status: Int32
  var output: String
  var timedOut: Bool
}

private struct MacCodexLatestReleaseSnapshot {
  let version: String?
  let checkedAt: Date
  let errorMessage: String?
}

final class MacSystemReadiness {
  private static let roleKey = "clawdad.setup.role.v1"
  // v2 adds an explicit user-selected project folder before any managed
  // runtime scans a removable volume. Existing native-beta installs revisit
  // the assistant once so macOS can attribute that consent to ClawDad.
  private static let completedKey = "clawdad.setup.completed.v2"
  private static let officialCodexInstaller = URL(
    string: "https://chatgpt.com/codex/install.sh"
  )!
  private static let officialCodexLatestRelease = URL(
    string: "https://releases.openai.com/codex/channels/latest"
  )!
  private static let latestReleaseCacheLifetime: TimeInterval = 10 * 60

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
  private var authenticationState = "idle"
  private var authenticationMessage = ""
  private var latestReleaseSnapshot: MacCodexLatestReleaseSnapshot?

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

  func status(
    forceCodexUpdateCheck: Bool = false,
    completion: @escaping ([String: Any]) -> Void
  ) {
    queue.async {
      let status = self.statusDictionary(
        forceCodexUpdateCheck: forceCodexUpdateCheck
      )
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
    let isUpdate = detectedCodexPath() != nil
    installState = "installing"
    installMessage = isUpdate
      ? "Downloading the official Codex update from OpenAI..."
      : "Downloading the official Codex installer from OpenAI..."
    queue.async {
      do {
        try self.installCodex()
        self.latestReleaseSnapshot = nil
        let installedVersion = self.detectedCodexPath().flatMap {
          macCodexNormalizedVersion(
            self.capture($0, ["--version"], timeout: 8).output
          )
        }
        self.updateInstallState(
          state: "installed",
          message: isUpdate
            ? "Codex \(installedVersion ?? "") was updated and is available to Terminal and ClawDad."
              .replacingOccurrences(of: "  ", with: " ")
            : "Codex \(installedVersion ?? "") is installed in ~/.local/bin and available to Terminal and ClawDad."
              .replacingOccurrences(of: "  ", with: " ")
        )
      } catch {
        self.updateInstallState(
          state: "failed",
          message: error.localizedDescription
        )
      }
    }
  }

  func openCodexLogin(resetCredentials: Bool = false) throws {
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
    let resultURL = loginDir.appendingPathComponent("codex-login-result.txt")
    try? FileManager.default.removeItem(at: resultURL)
    updateAuthenticationState(
      state: "reauthenticating",
      message: resetCredentials
        ? "A fresh ChatGPT sign-in is open in Terminal."
        : "ChatGPT sign-in is open in Terminal."
    )
    let home = FileManager.default.homeDirectoryForCurrentUser
    let codexHome = ProcessInfo.processInfo.environment["CODEX_HOME"]?
      .trimmingCharacters(in: .whitespacesAndNewlines)
    let sharedCodexHome = (codexHome?.isEmpty == false)
      ? codexHome!
      : home.appendingPathComponent(".codex", isDirectory: true).path
    let resetScript = resetCredentials
      ? """
        echo "Clearing the expired Codex sign-in..."
        \(shellQuote(codexPath)) app-server daemon stop >/dev/null 2>&1 || true
        \(shellQuote(codexPath)) logout >/dev/null 2>&1 || true
        echo
        """
      : ""
    let script = """
    #!/bin/zsh
    export CODEX_HOME=\(shellQuote(sharedCodexHome))
    export PATH=\(shellQuote(home.appendingPathComponent(".local/bin").path + ":/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"))
    clear
    echo "ClawDad Codex sign in"
    echo "Your browser will open so you can sign in with ChatGPT."
    echo
    \(resetScript)
    \(shellQuote(codexPath)) login
    login_exit=$?
    echo
    if [ "$login_exit" -eq 0 ]; then
      \(shellQuote(codexPath)) app-server daemon restart >/dev/null 2>&1 || true
      \(shellQuote(codexPath)) login status
      status_exit=$?
    else
      status_exit=$login_exit
    fi
    if [ "$status_exit" -eq 0 ]; then
      /usr/bin/printf 'ready\n' > \(shellQuote(resultURL.path))
      echo
      echo "Codex is signed in and ready for ClawDad."
    else
      /usr/bin/printf 'failed\n' > \(shellQuote(resultURL.path))
      echo
      echo "Codex sign in did not finish. Return to ClawDad to try again."
    fi
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

  private func statusDictionary(
    forceCodexUpdateCheck: Bool = false
  ) -> [String: Any] {
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
    let codexUpdate = codexUpdateDictionary(
      installedVersion: codexVersion,
      installed: codexPath != nil,
      shouldCheck: currentRole.needsLocalCodex,
      forceRefresh: forceCodexUpdateCheck
    )
    let login = codexPath.map {
      capture($0, ["login", "status"], timeout: 10)
    }
    let loginNeedsSignIn = login.map {
      macCodexAuthenticationNeedsSignIn(
        status: $0.status,
        output: $0.output,
        timedOut: $0.timedOut
      )
    } ?? true
    let codexLoggedIn = !loginNeedsSignIn
    let authentication = currentAuthenticationState(
      loginReady: codexLoggedIn,
      loginOutput: login?.output ?? ""
    )
    let requiresReauthentication = currentRole.needsLocalCodex && (
      loginNeedsSignIn ||
      authentication.state == "reauthenticating" ||
      authentication.state == "failed"
    )
    let state = currentInstallState()
    let completed = defaults.bool(forKey: Self.completedKey)
    let canComplete = nodeReady && orpReady && MacSystemReadinessPolicy.canComplete(
      role: currentRole,
      codexInstalled: codexPath != nil,
      codexLoggedIn: codexLoggedIn && !requiresReauthentication
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
        "installedVersion": macCodexNormalizedVersion(codexVersion) ?? "",
        "loggedIn": codexLoggedIn,
        "requiresReauthentication": requiresReauthentication,
        "authenticationState": authentication.state,
        "authenticationMessage": authentication.message,
        "loginStatus": login?.output ?? "",
        "home": (codexHome?.isEmpty == false)
          ? codexHome!
          : home.appendingPathComponent(".codex", isDirectory: true).path,
        "installerUrl": Self.officialCodexInstaller.absoluteString,
        "latestReleaseUrl": Self.officialCodexLatestRelease.absoluteString,
        "update": codexUpdate
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

  private func codexUpdateDictionary(
    installedVersion: String,
    installed: Bool,
    shouldCheck: Bool,
    forceRefresh: Bool
  ) -> [String: Any] {
    guard shouldCheck else {
      return [
        "state": "not-required",
        "available": false,
        "latestVersion": "",
        "checkedAt": "",
        "message": "Local Codex is optional for a controller-only Mac."
      ]
    }
    guard installed else {
      return [
        "state": "not-installed",
        "available": false,
        "latestVersion": "",
        "checkedAt": "",
        "message": "Install Codex before checking for updates."
      ]
    }
    guard let normalizedInstalled = macCodexNormalizedVersion(installedVersion) else {
      return [
        "state": "unavailable",
        "available": false,
        "latestVersion": "",
        "checkedAt": "",
        "message": "ClawDad could not interpret the installed Codex version."
      ]
    }

    let now = Date()
    let cachedSnapshot = latestReleaseSnapshot
    let cacheIsFresh = cachedSnapshot.map {
      now.timeIntervalSince($0.checkedAt) < Self.latestReleaseCacheLifetime
    } ?? false
    let snapshot: MacCodexLatestReleaseSnapshot
    if !forceRefresh, cacheIsFresh, let cachedSnapshot {
      snapshot = cachedSnapshot
    } else {
      snapshot = fetchLatestCodexRelease()
      latestReleaseSnapshot = snapshot
    }
    let checkedAt = ISO8601DateFormatter().string(from: snapshot.checkedAt)
    guard let latestVersion = snapshot.version else {
      return [
        "state": "unavailable",
        "available": false,
        "latestVersion": "",
        "checkedAt": checkedAt,
        "message": snapshot.errorMessage
          ?? "Codex update status is unavailable right now."
      ]
    }
    guard let updateAvailable = macCodexUpdateAvailable(
      installedVersion: normalizedInstalled,
      latestReleaseTag: latestVersion
    ) else {
      return [
        "state": "unavailable",
        "available": false,
        "latestVersion": latestVersion,
        "checkedAt": checkedAt,
        "message": "ClawDad could not compare the installed and current Codex versions."
      ]
    }

    if updateAvailable {
      return [
        "state": "available",
        "available": true,
        "latestVersion": latestVersion,
        "checkedAt": checkedAt,
        "message": "Codex \(latestVersion) is available."
      ]
    }
    return [
      "state": "current",
      "available": false,
      "latestVersion": latestVersion,
      "checkedAt": checkedAt,
      "message": normalizedInstalled == latestVersion
        ? "Codex \(normalizedInstalled) is the current release."
        : "This Codex build is newer than the current public release."
    ]
  }

  private func fetchLatestCodexRelease() -> MacCodexLatestReleaseSnapshot {
    let checkedAt = Date()
    let configuration = URLSessionConfiguration.ephemeral
    configuration.timeoutIntervalForRequest = 5
    configuration.timeoutIntervalForResource = 6
    let session = URLSession(configuration: configuration)
    var request = URLRequest(url: Self.officialCodexLatestRelease)
    request.cachePolicy = .reloadIgnoringLocalCacheData
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    let semaphore = DispatchSemaphore(value: 0)
    var releaseVersion: String?
    var releaseError: String?
    session.dataTask(with: request) { data, response, error in
      defer { semaphore.signal() }
      if error != nil {
        releaseError = "Codex update status is unavailable right now. You can try again."
        return
      }
      guard let http = response as? HTTPURLResponse,
            http.statusCode == 200,
            let data,
            let version = macCodexLatestVersion(from: data) else {
        releaseError = "OpenAI's current Codex release could not be verified. You can try again."
        return
      }
      releaseVersion = version
    }.resume()
    guard semaphore.wait(timeout: .now() + 7) == .success else {
      session.invalidateAndCancel()
      return MacCodexLatestReleaseSnapshot(
        version: nil,
        checkedAt: checkedAt,
        errorMessage: "The Codex update check timed out. You can try again."
      )
    }
    session.finishTasksAndInvalidate()
    return MacCodexLatestReleaseSnapshot(
      version: releaseVersion,
      checkedAt: checkedAt,
      errorMessage: releaseError
    )
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

  private func updateAuthenticationState(state: String, message: String) {
    stateLock.lock()
    authenticationState = state
    authenticationMessage = message
    stateLock.unlock()
  }

  private func currentAuthenticationState(
    loginReady: Bool,
    loginOutput: String
  ) -> (state: String, message: String) {
    let resultURL = supportDir
      .appendingPathComponent("setup", isDirectory: true)
      .appendingPathComponent("codex-login-result.txt")
    let result = (try? String(contentsOf: resultURL, encoding: .utf8))?
      .trimmingCharacters(in: .whitespacesAndNewlines)
      .lowercased() ?? ""

    stateLock.lock()
    defer { stateLock.unlock() }
    if result == "ready", loginReady {
      authenticationState = "ready"
      authenticationMessage = "Codex is signed in and ready."
    } else if result == "failed" {
      authenticationState = "failed"
      authenticationMessage = "Codex sign in did not finish. Click Sign In Again to retry."
    } else if !loginReady && authenticationState != "reauthenticating" {
      authenticationState = "required"
      authenticationMessage = loginOutput.isEmpty
        ? "Sign in with ChatGPT to use Codex on this Mac."
        : "Codex needs a fresh ChatGPT sign-in on this Mac."
    } else if loginReady && authenticationState == "idle" {
      authenticationState = "ready"
      authenticationMessage = "Codex is signed in and ready."
    }
    return (authenticationState, authenticationMessage)
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
