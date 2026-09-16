import Foundation
import CryptoKit
import Darwin
import ClawDadRemoteAssistProtocol

/// Read-only account-transition evidence for an exact foreground process.
/// No environment values except filesystem homes are decoded or returned.
struct MacCodexAccountProcess {
  struct Facts: Equatable {
    var arguments: [String]
    var codexHome: String?
    var home: String?
    var alternateAuthentication: Bool
    var accountTransitionId: String?
    var accountLaunchRequestId: String?
  }

  static func facts(_ data: Data) -> Facts? {
    guard let arguments=macCodexArgumentsFromProcessData(data),data.count>4,
      let end=data[4...].firstIndex(of:0) else { return nil }
    var cursor=end+1
    while cursor<data.count,data[cursor]==0 { cursor += 1 }
    for _ in arguments {
      guard let end=data[cursor...].firstIndex(of:0) else { return nil };cursor=end+1
    }
    var value=Facts(arguments:arguments,alternateAuthentication:false)
    let prohibited=["OPENAI_API_KEY=","CODEX_API_KEY=","CODEX_ACCESS_TOKEN=","OPENAI_BASE_URL="]
    while cursor<data.count {
      guard let end=data[cursor...].firstIndex(of:0) else { return nil }
      let entry=data[cursor..<end];cursor=end+1
      if entry.isEmpty { continue }
      for prefix in prohibited where entry.starts(with:prefix.utf8) && entry.count>prefix.utf8.count { value.alternateAuthentication=true }
      for prefix in ["CODEX_HOME=","HOME="] where entry.starts(with:prefix.utf8) {
        guard let text=String(data:entry.dropFirst(prefix.utf8.count),encoding:.utf8),text.hasPrefix("/"),
          !text.contains(where:{$0.isNewline}),text.utf8.count<=4096 else { return nil }
        if prefix=="CODEX_HOME=" { value.codexHome=text } else { value.home=text }
      }
      let transitionPrefix="CLAWDAD_ACCOUNT_TRANSITION_ID="
      if entry.starts(with:transitionPrefix.utf8),let text=String(data:entry.dropFirst(transitionPrefix.utf8.count),encoding:.utf8),
        text.range(of:#"^[A-Za-z0-9_.:-]{1,160}$"#,options:.regularExpression) != nil {value.accountTransitionId=text}
      let launchPrefix="CLAWDAD_ACCOUNT_LAUNCH_REQUEST_ID="
      if entry.starts(with:launchPrefix.utf8),let text=String(data:entry.dropFirst(launchPrefix.utf8.count),encoding:.utf8),
        text.range(of:#"^[a-f0-9]{64}$"#,options:.regularExpression) != nil {value.accountLaunchRequestId=text}
    }
    return value
  }

  static func readFacts(_ pid:String)->Facts? {
    guard let process=Int32(pid),process>0 else { return nil }
    var mib:[Int32]=[CTL_KERN,KERN_PROCARGS2,process],size=0
    guard sysctl(&mib,UInt32(mib.count),nil,&size,nil,0)==0,size>4,size<=2*1024*1024 else { return nil }
    var bytes=Data(count:size)
    defer { bytes.resetBytes(in:0..<bytes.count) }
    guard bytes.withUnsafeMutableBytes({sysctl(&mib,UInt32(mib.count),$0.baseAddress,&size,nil,0)})==0 else { return nil }
    return facts(bytes.prefix(size))
  }

  /// Select history from this foreground process, never from a project-name
  /// search. Private retained profiles may have a different history root.
  static func ownerReader(tty:String) throws -> MacTerminalResponseReader {
    var reader=MacTerminalResponseReader();reader.acceptedConversationSources=["cli","vscode"]
    let owner=try MacTerminalResponseReader.inputOwner(reader.run("/bin/ps",["-t",String(tty.dropFirst(5)),"-o","pid=,pgid=,tpgid=,stat=,lstart=,comm="]))
    guard let facts=readFacts(owner.pid),let home=facts.codexHome ?? facts.home.map({$0+"/.codex"}) else { throw failure("authorization_home_unavailable") }
    reader.sessionRoot=URL(fileURLWithPath:home,isDirectory:true).appendingPathComponent("sessions",isDirectory:true)
    let binding=try reader.inputBinding(tty:tty)
    guard binding.pid==owner.pid,readFacts(owner.pid)==facts else { throw failure("process_home_changed") }
    return reader
  }

  /// Retain only reviewed launch flags. Positional prompts and initial images
  /// must never be replayed. Unknown options remain an actionable stop.
  static func options(_ arguments:[String],allowVerifiedAccountRouting:Bool=false) throws -> [String] {
    guard !arguments.isEmpty else { throw failure("launch_arguments_unavailable") }
    let switches:Set<String>=["--strict-config","--search","--no-alt-screen","--approve-for-me","--dangerously-bypass-approvals-and-sandbox","--dangerously-bypass-hook-trust"]
    let values:Set<String>=["-m","--model","-p","--profile","-s","--sandbox","-a","--ask-for-approval","--enable","--disable","--add-dir"]
    var output:[String]=[],index=1,positional=0,resuming=false
    while index<arguments.count {
      let argument=arguments[index]
      if argument=="--" { break } // Everything following is a positional prompt.
      if argument=="resume",positional==0,!resuming { resuming=true;index += 1;continue }
      if ["exec","review","fork","app-server","--remote","--worktree","--oss","--local-provider","--remote-auth-token-env"].contains(argument) { throw failure("unsupported_launch_mode") }
      if switches.contains(argument) { output.append(argument);index += 1;continue }
      if ["--last","--all","--include-non-interactive"].contains(argument),resuming { index += 1;continue }
      if argument=="-C" || argument=="--cd" || argument=="-i" || argument=="--image" {
        guard index+1<arguments.count else { throw failure("incomplete_launch_option") };index += 2;continue
      }
      if argument.hasPrefix("--cd=") || argument.hasPrefix("-C") && argument.count>2 { index += 1;continue }
      if argument=="-c" || argument=="--config" {
        guard index+1<arguments.count else { throw failure("incomplete_launch_option") }
        let option=arguments[index+1]
        // Choosing Keychain storage is a supported CLI setting, including for
        // manually launched profiles. It does not prove the cached account.
        // Every recreated process uses the separately verified destination.
        if option=="cli_auth_credentials_store=\"keyring\"" {index += 2;continue}
        if allowVerifiedAccountRouting {
          if option.hasPrefix("sqlite_home="),let data=String(option.dropFirst("sqlite_home=".count)).data(using:.utf8),
            let directory=try? JSONDecoder().decode(String.self,from:data),directory.hasPrefix("/"),
            !directory.unicodeScalars.contains(where:CharacterSet.controlCharacters.contains) {index += 2;continue}
        }
        // User-supplied provider credentials, arbitrary instructions and paths
        // are never serialized as process evidence. They need explicit support.
        guard option=="tui.terminal_title=[]" || option.range(of:#"^(features\.[A-Za-z0-9_]+=(true|false)|model_reasoning_effort="?[a-z_]+"?)$"#,options:.regularExpression) != nil else { throw failure("unsupported_configuration_override") }
        output += [argument,option];index += 2;continue
      }
      if values.contains(argument) {
        guard index+1<arguments.count else { throw failure("incomplete_launch_option") }
        let value=arguments[index+1]
        if argument=="--add-dir" {
          guard value.hasPrefix("/"),!value.contains(where:{$0.isNewline}),value.utf8.count<=4096 else { throw failure("relative_permission_directory") }
        } else {
          guard value.range(of:#"^[A-Za-z0-9_.:/-]{1,160}$"#,options:.regularExpression) != nil else { throw failure("unsupported_launch_value") }
        }
        output += [argument,value];index += 2;continue
      }
      if argument.hasPrefix("-") { throw failure("unsupported_launch_option") }
      positional += 1
      guard positional <= (resuming ? 2:1) else { throw failure("ambiguous_launch_arguments") }
      index += 1
    }
    return output
  }

  static func inspect(tty:String,reader:MacTerminalResponseReader=MacTerminalResponseReader(),read:@Sendable(String)->Facts?=readFacts) throws -> [String:AssistantValue] {
    // A conversation first created in the app-server can later be explicitly
    // resumed in a standalone TUI. Its origin is history metadata, not current
    // ownership. This read-only inventory still requires the unique foreground
    // binary, live rollout handle and matching process before/after the read.
    // Existing native composer action adapters retain their own source policy.
    var reader=reader;reader.acceptedConversationSources=["cli","vscode"]
    let binding=try reader.inputBinding(tty:tty)
    guard let facts=read(binding.pid) else { throw failure("launch_environment_unavailable") }
    let home=facts.codexHome ?? facts.home.map{URL(fileURLWithPath:$0).appendingPathComponent(".codex").path}
    guard let home,home.hasPrefix("/") else { throw failure("authorization_home_unavailable") }
    var fields=binding.fields
    fields["authorizationHome"] = .string(home)
    fields["historyOrigin"] = binding.conversation.map{.string($0.origin)} ?? .null
    fields["alternateAuthentication"] = .bool(facts.alternateAuthentication)
    fields["isBusy"] = .null
    fields["busyEvidence"] = .string("awaiting_first_turn")
    fields["accountVerified"] = .bool(false)
    fields["accountReason"] = .string("A process home identifies its credential source, not the account cached in that running process. Verify the account during an authorized transition.")
    do { fields["resumeOptions"] = .array(try options(facts.arguments).map(AssistantValue.string)) }
    catch let error as MacCodexInputFailure { fields["launchReasonCode"] = .string(error.code) }
    if let conversation=binding.conversation,let config=MacMainWorkspaceNative.resumeConfiguration(conversation.path) {
      fields["model"] = .string(config.model);fields["reasoningEffort"] = config.effort.map(AssistantValue.string) ?? .null
      fields["settingsEvidence"] = .string("last_persisted_turn")
    }
    if let conversation=binding.conversation {
      var activity=MacCodexRequestActivityLog()
      do {
        fields["isBusy"] = .bool(try activity.read(conversation.path))
        fields["busyEvidence"] = .string("owning_transcript_lifecycle")
        fields["activeTurnId"] = activity.turnId.map(AssistantValue.string) ?? .null
      } catch { fields["busyEvidence"] = .string("transcript_unavailable") }
    }
    guard try reader.inputBinding(tty:tty)==binding else { throw failure("process_changed") }
    return fields
  }

  private static func failure(_ code:String)->MacCodexInputFailure {
    .init(code:code,message:"This Codex launch needs a verified account-transition adapter (\(code)). The running process and input were preserved.")
  }
}
