import XCTest
@testable import ClawDad

final class NativeRuntimeProcessOwnershipTests: XCTestCase {
  private let supportDir = URL(
    fileURLWithPath: "/Users/example/Library/Application Support/ClawDad",
    isDirectory: true
  )
  private let homeDir = URL(fileURLWithPath: "/Users/example", isDirectory: true)

  func testProcessListParserPreservesCommandsContainingSpaces() {
    let output = """
      101     1   501 /Users/example/Library/Application Support/ClawDad/runtime/bin/node /Users/example/Library/Application Support/ClawDad/runtime/lib/server.mjs serve --host 127.0.0.1 --port 4487 --auth-mode token --token-file /Users/example/Library/Application Support/ClawDad/native-server.token
      malformed row
    """

    let records = NativeRuntimeProcessPolicy.parseProcessList(output)

    XCTAssertEqual(records.count, 1)
    XCTAssertEqual(records[0].pid, 101)
    XCTAssertEqual(records[0].parentPID, 1)
    XCTAssertEqual(records[0].uid, 501)
    XCTAssertTrue(records[0].command.contains("Application Support/ClawDad/runtime/bin/node"))
  }

  func testOrphanSelectionRequiresExactCurrentUserManagedCommands() {
    let paths = NativeRuntimeProcessPaths(supportDir: supportDir, homeDir: homeDir)
    let server = "\(paths.nodePath) \(paths.serverPath) serve --host 127.0.0.1 --port 4487 --auth-mode token --token-file \(paths.tokenFilePath)"
    let cloud = "\(paths.nodePath) \(paths.serverPath) cloud-host --config \(paths.cloudConfigPath) --local-url http://127.0.0.1:4488/ --local-token-file \(paths.tokenFilePath)"
    let records = [
      NativeRuntimeProcessRecord(pid: 101, parentPID: 1, uid: 501, command: server),
      NativeRuntimeProcessRecord(pid: 102, parentPID: 1, uid: 501, command: cloud),
      NativeRuntimeProcessRecord(pid: 103, parentPID: 77, uid: 501, command: server),
      NativeRuntimeProcessRecord(pid: 104, parentPID: 1, uid: 502, command: server),
      NativeRuntimeProcessRecord(pid: 105, parentPID: 1, uid: 501, command: server + " --extra"),
      NativeRuntimeProcessRecord(
        pid: 106,
        parentPID: 1,
        uid: 501,
        command: server.replacingOccurrences(of: "--port 4487", with: "--port 4518")
      ),
      NativeRuntimeProcessRecord(pid: 999, parentPID: 1, uid: 501, command: server)
    ]

    let selected = NativeRuntimeProcessPolicy.orphanedManagedProcesses(
      in: records,
      paths: paths,
      currentUID: 501,
      currentPID: 999
    )

    XCTAssertEqual(selected.map(\.pid), [101, 102])
  }

  func testManagedChildTerminatorWaitsForOwnedProcessExit() throws {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/bin/sleep")
    process.arguments = ["30"]
    try process.run()
    XCTAssertTrue(process.isRunning)

    NativeManagedProcessTerminator.stop(process, gracePeriod: 0.25)

    XCTAssertFalse(process.isRunning)
  }
}
