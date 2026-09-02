import Darwin
import Foundation

struct NativeRuntimeProcessRecord: Equatable {
  let pid: pid_t
  let parentPID: pid_t
  let uid: uid_t
  let command: String
}

struct NativeRuntimeProcessPaths {
  let nodePath: String
  let serverPath: String
  let tokenFilePath: String
  let cloudConfigPath: String

  init(supportDir: URL, homeDir: URL = FileManager.default.homeDirectoryForCurrentUser) {
    let runtimeDir = supportDir.appendingPathComponent("runtime", isDirectory: true)
    self.nodePath = runtimeDir.appendingPathComponent("bin/node").path
    self.serverPath = runtimeDir.appendingPathComponent("lib/server.mjs").path
    self.tokenFilePath = supportDir.appendingPathComponent("native-server.token").path
    self.cloudConfigPath = homeDir
      .appendingPathComponent(".clawdad", isDirectory: true)
      .appendingPathComponent("cloud.json")
      .path
  }
}

enum NativeRuntimeProcessPolicy {
  private static let allowedPorts = 4487...4517

  static func parseProcessList(_ output: String) -> [NativeRuntimeProcessRecord] {
    output.split(whereSeparator: \.isNewline).compactMap { rawLine in
      let fields = rawLine.split(
        maxSplits: 3,
        omittingEmptySubsequences: true
      ) { character in
        character == " " || character == "\t"
      }
      guard fields.count == 4,
            let pid = Int32(fields[0]),
            let parentPID = Int32(fields[1]),
            let uid = UInt32(fields[2]) else {
        return nil
      }
      return NativeRuntimeProcessRecord(
        pid: pid,
        parentPID: parentPID,
        uid: uid,
        command: String(fields[3])
      )
    }
  }

  static func orphanedManagedProcesses(
    in records: [NativeRuntimeProcessRecord],
    paths: NativeRuntimeProcessPaths,
    currentUID: uid_t,
    currentPID: pid_t
  ) -> [NativeRuntimeProcessRecord] {
    records.filter { record in
      record.pid != currentPID
        && record.parentPID == 1
        && record.uid == currentUID
        && isExactManagedCommand(record.command, paths: paths)
    }
  }

  static func isExactManagedCommand(
    _ command: String,
    paths: NativeRuntimeProcessPaths
  ) -> Bool {
    isExactServerCommand(command, paths: paths)
      || isExactCloudHostCommand(command, paths: paths)
  }

  private static func port(
    in command: String,
    prefix: String,
    suffix: String
  ) -> Int? {
    guard command.hasPrefix(prefix), command.hasSuffix(suffix) else {
      return nil
    }
    let start = command.index(command.startIndex, offsetBy: prefix.count)
    let end = command.index(command.endIndex, offsetBy: -suffix.count)
    guard start <= end else {
      return nil
    }
    return Int(command[start..<end])
  }

  private static func isExactServerCommand(
    _ command: String,
    paths: NativeRuntimeProcessPaths
  ) -> Bool {
    let prefix = "\(paths.nodePath) \(paths.serverPath) serve --host 127.0.0.1 --port "
    let suffix = " --auth-mode token --token-file \(paths.tokenFilePath)"
    guard let selectedPort = port(in: command, prefix: prefix, suffix: suffix) else {
      return false
    }
    return allowedPorts.contains(selectedPort)
  }

  private static func isExactCloudHostCommand(
    _ command: String,
    paths: NativeRuntimeProcessPaths
  ) -> Bool {
    let prefix = "\(paths.nodePath) \(paths.serverPath) cloud-host --config \(paths.cloudConfigPath) --local-url http://127.0.0.1:"
    let suffix = "/ --local-token-file \(paths.tokenFilePath)"
    guard let selectedPort = port(in: command, prefix: prefix, suffix: suffix) else {
      return false
    }
    return allowedPorts.contains(selectedPort)
  }
}

enum NativeManagedProcessTerminator {
  static func stop(_ process: Process, gracePeriod: TimeInterval = 1.5) {
    guard process.isRunning else {
      return
    }
    process.terminate()
    let deadline = Date().addingTimeInterval(max(0, gracePeriod))
    while process.isRunning && Date() < deadline {
      Thread.sleep(forTimeInterval: 0.05)
    }
    if process.isRunning {
      Darwin.kill(process.processIdentifier, SIGKILL)
    }
    process.waitUntilExit()
  }
}

enum NativeRuntimeOrphanReaper {
  static func reap(supportDir: URL, gracePeriod: TimeInterval = 2.0) throws {
    let paths = NativeRuntimeProcessPaths(supportDir: supportDir)
    var candidates = NativeRuntimeProcessPolicy.orphanedManagedProcesses(
      in: try processSnapshot(),
      paths: paths,
      currentUID: getuid(),
      currentPID: getpid()
    )
    guard !candidates.isEmpty else {
      return
    }

    for candidate in candidates {
      try signalIfStillVerified(candidate, signal: SIGTERM, paths: paths)
    }
    candidates = try waitForExit(
      candidates,
      paths: paths,
      timeout: max(0, gracePeriod)
    )

    for candidate in candidates {
      try signalIfStillVerified(candidate, signal: SIGKILL, paths: paths)
    }
    let survivors = try waitForExit(candidates, paths: paths, timeout: 1.0)
    guard survivors.isEmpty else {
      let processList = survivors.map { String($0.pid) }.joined(separator: ", ")
      throw NSError(
        domain: "ClawDad",
        code: 12,
        userInfo: [
          NSLocalizedDescriptionKey:
            "ClawDad could not stop a verified leftover host process (\(processList)). Restart the Mac and open ClawDad again."
        ]
      )
    }
  }

  private static func processSnapshot() throws -> [NativeRuntimeProcessRecord] {
    let process = Process()
    let output = Pipe()
    let errors = Pipe()
    process.executableURL = URL(fileURLWithPath: "/bin/ps")
    process.arguments = ["-axo", "pid=,ppid=,uid=,command="]
    process.standardOutput = output
    process.standardError = errors
    try process.run()
    let outputData = output.fileHandleForReading.readDataToEndOfFile()
    let errorData = errors.fileHandleForReading.readDataToEndOfFile()
    process.waitUntilExit()
    guard process.terminationStatus == 0 else {
      let detail = String(data: errorData, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines)
      throw NSError(
        domain: "ClawDad",
        code: 11,
        userInfo: [
          NSLocalizedDescriptionKey:
            detail?.isEmpty == false
              ? "ClawDad could not inspect its prior host processes: \(detail!)"
              : "ClawDad could not inspect its prior host processes."
        ]
      )
    }
    return NativeRuntimeProcessPolicy.parseProcessList(
      String(data: outputData, encoding: .utf8) ?? ""
    )
  }

  private static func verifiedRecord(
    for candidate: NativeRuntimeProcessRecord,
    paths: NativeRuntimeProcessPaths
  ) throws -> NativeRuntimeProcessRecord? {
    NativeRuntimeProcessPolicy.orphanedManagedProcesses(
      in: try processSnapshot(),
      paths: paths,
      currentUID: getuid(),
      currentPID: getpid()
    ).first { record in
      record.pid == candidate.pid && record.command == candidate.command
    }
  }

  private static func signalIfStillVerified(
    _ candidate: NativeRuntimeProcessRecord,
    signal: Int32,
    paths: NativeRuntimeProcessPaths
  ) throws {
    guard try verifiedRecord(for: candidate, paths: paths) != nil else {
      return
    }
    if Darwin.kill(candidate.pid, signal) != 0 && errno != ESRCH {
      throw NSError(
        domain: NSPOSIXErrorDomain,
        code: Int(errno),
        userInfo: [
          NSLocalizedDescriptionKey:
            "ClawDad could not stop verified leftover host process \(candidate.pid)."
        ]
      )
    }
  }

  private static func waitForExit(
    _ candidates: [NativeRuntimeProcessRecord],
    paths: NativeRuntimeProcessPaths,
    timeout: TimeInterval
  ) throws -> [NativeRuntimeProcessRecord] {
    guard !candidates.isEmpty else {
      return []
    }
    let deadline = Date().addingTimeInterval(timeout)
    var survivors = candidates
    repeat {
      let liveRecords = try processSnapshot()
      let verified = NativeRuntimeProcessPolicy.orphanedManagedProcesses(
        in: liveRecords,
        paths: paths,
        currentUID: getuid(),
        currentPID: getpid()
      )
      survivors = candidates.filter { candidate in
        verified.contains { record in
          record.pid == candidate.pid && record.command == candidate.command
        }
      }
      if survivors.isEmpty || Date() >= deadline {
        return survivors
      }
      Thread.sleep(forTimeInterval: 0.05)
    } while true
  }
}
