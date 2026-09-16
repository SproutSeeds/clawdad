import Foundation
import XCTest
@testable import ClawDad

final class MacCodexAccountProcessTests:XCTestCase {
  private func data(_ arguments:[String],_ environment:[String])->Data {
    var count=Int32(arguments.count),data=withUnsafeBytes(of:&count){Data($0)}
    data.append(Data(("/fixture/codex\0\0"+arguments.joined(separator:"\0")+"\0"+environment.joined(separator:"\0")+"\0\0").utf8));return data
  }
  func testEnvironmentFactsReturnOnlyHomesAndAlternateAuthenticationPresence() throws {
    let result=try XCTUnwrap(MacCodexAccountProcess.facts(data(["codex","-c","features.code_mode_host=true"],
      ["HOME=/fixture/user","CODEX_HOME=/fixture/retained","OPENAI_API_KEY=private-marker","OTHER_SECRET=not-returned"])))
    XCTAssertEqual(result.home,"/fixture/user");XCTAssertEqual(result.codexHome,"/fixture/retained");XCTAssertTrue(result.alternateAuthentication)
    XCTAssertFalse(String(describing:result).contains("private-marker"));XCTAssertFalse(String(describing:result).contains("not-returned"))
    XCTAssertFalse(try XCTUnwrap(MacCodexAccountProcess.facts(data(["codex"],["OPENAI_API_KEY="]))).alternateAuthentication)
    XCTAssertNil(MacCodexAccountProcess.facts(Data([1,0])))
  }
  func testResumeOptionsPreserveConfigurationButNeverReplayOldPromptImageOrPickerSelection() throws {
    let source=["codex","-c","features.code_mode_host=true","resume","exact-id","--all","--cd","/fixture/one project",
      "--model","gpt-6-astra","-c","model_reasoning_effort=\"max\"","--sandbox","read-only","--ask-for-approval","never",
      "--image","/fixture/old.png","old task text"]
    XCTAssertEqual(try MacCodexAccountProcess.options(source),["-c","features.code_mode_host=true","--model","gpt-6-astra","-c","model_reasoning_effort=\"max\"","--sandbox","read-only","--ask-for-approval","never"])
    XCTAssertEqual(try MacCodexAccountProcess.options(["codex","--no-alt-screen","--","old prompt","--search"]),["--no-alt-screen"])
    XCTAssertEqual(try MacCodexAccountProcess.options(["codex","-C/one","--enable","plugins","--add-dir","/exact/write directory"]),["--enable","plugins","--add-dir","/exact/write directory"])
  }
  func testRemoteFreshWorktreeAndUnrecognizedOrSensitiveOverridesRequireAnAdapter() {
    for args in [["codex","--remote","unix://fixture"],["codex","--worktree"],["codex","exec"],
      ["codex","-c","model_providers.secret.http_headers={x=\"private\"}"],["codex","--new-unknown-flag"],
      ["codex","--add-dir","relative"],["codex","-m"],["codex","--config=features.test=true"]] {
      XCTAssertThrowsError(try MacCodexAccountProcess.options(args)){error in
        XCTAssertFalse(error.localizedDescription.contains("private"))
      }
    }
  }
  func testReadOnlyInspectionBindsActualMappedBinaryAndExactProcessWithoutInferringAccount() throws {
    let tty="/dev/ttys099",ps="42 42 42 S+ Wed Sep 9 09:53:57 2026 /fixture/codex"
    let reader=MacTerminalResponseReader(run:{executable,args in
      if executable=="/bin/ps" { return ps }
      if executable=="/usr/sbin/lsof" { return args.contains("cwd,txt") ? "p42\nfcwd\nn/fixture/project\nftxt\nn/fixture/pinned/codex\n":"p42\n" }
      XCTAssertEqual(executable,"/fixture/pinned/codex");return "codex-cli 0.154.0"
    },inputArguments:{_ in ["codex"]})
    let result=try MacCodexAccountProcess.inspect(tty:tty,reader:reader,read:{_ in .init(arguments:["codex","-c","features.code_mode_host=true"],codexHome:"/fixture/profile",home:"/fixture/user",alternateAuthentication:false)})
    XCTAssertEqual(result["executable"]?.string,"/fixture/pinned/codex");XCTAssertEqual(result["authorizationHome"]?.string,"/fixture/profile")
    XCTAssertEqual(result["accountVerified"]?.bool,false);XCTAssertEqual(result["historyState"]?.string,"awaiting_first_turn")
    XCTAssertNil(result["isBusy"]?.bool);XCTAssertEqual(result["busyEvidence"]?.string,"awaiting_first_turn")
    XCTAssertEqual(result["resumeOptions"]?.array?.count,2)
  }
  func testHistoricalOriginDoesNotReplaceCurrentOwnershipAndInputAdaptersKeepTheirExistingPolicy() throws {
    let root=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at:root,withIntermediateDirectories:true)
    defer{try? FileManager.default.removeItem(at:root)}
    let id=UUID().uuidString.lowercased(),url=root.appendingPathComponent("rollout-fixture-\(id).jsonl")
    var data=try JSONSerialization.data(withJSONObject:["type":"session_meta","payload":["id":id,"source":"vscode","cwd":"/fixture/project"]]);data.append(10);try data.write(to:url)
    if case .unsupported=try MacCodexConversation.metadata(path:url,sessionRoot:root) {} else { XCTFail("Composer defaults must retain their existing policy") }
    let readOnly=try MacCodexConversation.metadata(path:url,sessionRoot:root,acceptedSources:["cli","vscode"])
    guard case .conversation(let conversation)=readOnly else { return XCTFail("The explicit read-only source policy should recognize retained history") }
    XCTAssertEqual(conversation.sessionId,id);XCTAssertEqual(conversation.origin,"vscode")
    if case .unrelated=try MacCodexConversation.metadata(path:url,sessionRoot:root.appendingPathComponent("other"),acceptedSources:["vscode"]) {} else { XCTFail("History root remains exact") }
  }
  func testReadOnlyBusyEvidenceComesFromThisOwnerLifecycleAcrossCompletion() throws {
    let root=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at:root,withIntermediateDirectories:true)
    defer{try? FileManager.default.removeItem(at:root)}
    let id=UUID().uuidString.lowercased(),url=root.appendingPathComponent("rollout-fixture-\(id).jsonl")
    func append(_ record:[String:Any]) throws {
      var data=try JSONSerialization.data(withJSONObject:record);data.append(10)
      if FileManager.default.fileExists(atPath:url.path) {
        let handle=try FileHandle(forWritingTo:url);defer{try? handle.close()};try handle.seekToEnd();try handle.write(contentsOf:data)
      } else { try data.write(to:url) }
    }
    try append(["type":"session_meta","payload":["id":id,"source":"vscode","cwd":"/fixture/project"]])
    try append(["type":"event_msg","timestamp":"2026-09-16T01:02:03Z","payload":["type":"task_started","turn_id":"fixture-turn"]])
    let reader=MacTerminalResponseReader(run:{executable,args in
      if executable=="/bin/ps" { return "42 42 42 S+ Wed Sep 9 09:53:57 2026 /fixture/codex" }
      if executable=="/usr/sbin/lsof" { return args.contains("cwd,txt") ? "p42\nfcwd\nn/fixture/project\nftxt\nn/fixture/pinned/codex\n":"p42\nn\(url.path)\n" }
      return "codex-cli 0.154.0"
    },sessionRoot:root,inputArguments:{_ in ["codex"]})
    let read:@Sendable(String)->MacCodexAccountProcess.Facts?={_ in .init(arguments:["codex"],home:"/fixture/user",alternateAuthentication:false)}
    let working=try MacCodexAccountProcess.inspect(tty:"/dev/ttys099",reader:reader,read:read)
    XCTAssertEqual(working["isBusy"]?.bool,true);XCTAssertEqual(working["activeTurnId"]?.string,"fixture-turn")
    XCTAssertEqual(working["busyEvidence"]?.string,"owning_transcript_lifecycle")
    try append(["type":"event_msg","timestamp":"2026-09-16T01:03:03Z","payload":["type":"task_complete","turn_id":"fixture-turn"]])
    let idle=try MacCodexAccountProcess.inspect(tty:"/dev/ttys099",reader:reader,read:read)
    XCTAssertEqual(idle["isBusy"]?.bool,false);XCTAssertEqual(idle["sessionId"]?.string,id)
    XCTAssertEqual(idle["historyOrigin"]?.string,"vscode");XCTAssertEqual(idle["accountVerified"]?.bool,false)
  }
  func testLiveProcessMetadataReadOnlyWhenExplicitlyRequested() throws {
    guard ProcessInfo.processInfo.environment["CLAWDAD_ACCOUNT_READONLY_LIVE"]=="1" else { throw XCTSkip("Explicit read-only live process audit") }
    let output=try macTerminalResponseCommand("/bin/ps",["-axo","tty=,comm="])
    let ttys=Set(output.split(separator:"\n").compactMap{line->String? in
      let row=line.split(maxSplits:1,whereSeparator:\.isWhitespace)
      guard row.count==2,row[0].hasPrefix("ttys"),URL(fileURLWithPath:String(row[1])).lastPathComponent=="codex" else { return nil }
      return "/dev/"+String(row[0])
    })
    XCTAssertFalse(ttys.isEmpty)
    var observations:[[String:Any]]=[]
    for tty in ttys.sorted() {
      do {
        let fields=try MacCodexAccountProcess.inspect(tty:tty)
        observations.append(["tty":tty,"processId":fields["processId"]?.string ?? "","sessionId":fields["sessionId"]?.string ?? "",
          "version":fields["cliVersion"]?.string ?? "","historyState":fields["historyState"]?.string ?? "",
          "homeObserved":fields["authorizationHome"]?.string != nil,"accountVerified":fields["accountVerified"]?.bool ?? false,
          "busyEvidence":fields["busyEvidence"]?.string ?? "","busy":fields["isBusy"]?.bool as Any? ?? NSNull(),
          "launchReasonCode":fields["launchReasonCode"]?.string ?? "","resumeOptionsAvailable":fields["resumeOptions"]?.array != nil])
      } catch { observations.append(["tty":tty,"reasonCode":(error as? MacCodexInputFailure)?.code ?? "inspection_failed"]) }
    }
    let repo=URL(fileURLWithPath:#filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    let folder=repo.appendingPathComponent("native/macos/dist/candidates/codex-account-switch-2026-09-15")
    let data=try JSONSerialization.data(withJSONObject:["at":ISO8601DateFormatter().string(from:Date()),"readOnly":true,"observations":observations],options:[.prettyPrinted,.sortedKeys])
    let stamp=ISO8601DateFormatter().string(from:Date()).replacingOccurrences(of:":",with:"-")
    try data.write(to:folder.appendingPathComponent("native-account-process-\(stamp).json"),options:.withoutOverwriting)
    XCTAssertTrue(observations.contains{$0["resumeOptionsAvailable"] as? Bool==true})
  }
}
