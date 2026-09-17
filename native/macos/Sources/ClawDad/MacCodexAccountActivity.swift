import Foundation
import CryptoKit
import Darwin
import ClawDadRemoteAssistProtocol

/// A bounded, read-only census of local Codex credential consumers, including
/// app servers and background exec processes with no Terminal TTY. No arguments,
/// tokens or non-home environment values leave the transient process reader.
struct MacCodexAccountActivity {
  struct ProcessRow:Equatable {
    var pid:String
    var identity:String
    var executable:String
  }
  static func rows(_ text:String,uid:uid_t=getuid(),knownExecutables:Set<String>=[]) throws->[ProcessRow] {
    var result:[ProcessRow]=[]
    for line in text.split(separator:"\n") {
      var fields=line.split(maxSplits:7,whereSeparator:\.isWhitespace).map(String.init)
      guard fields.count==8,let process=Int32(fields[0]),process>0,let owner=uid_t(fields[1]) else {
        throw failure("process_inventory_incomplete")
      }
      guard owner==uid else { continue }
      let executable=fields[7].trimmingCharacters(in:.whitespacesAndNewlines)
      fields[7]=executable
      guard URL(fileURLWithPath:executable).lastPathComponent=="codex" || knownExecutables.contains(executable) else { continue }
      let identity=SHA256.hash(data:Data(fields.joined(separator:"\0").utf8)).map{String(format:"%02x",$0)}.joined()
      result.append(.init(pid:fields[0],identity:identity,executable:executable))
    }
    guard Set(result.map(\.pid)).count==result.count,result.count<=512 else { throw failure("process_inventory_incomplete") }
    return result.sorted{$0.pid<$1.pid}
  }
  static func inspect(home:String,run:(String,[String]) throws->String=macTerminalResponseCommand,
    read:(String)->MacCodexAccountProcess.Facts?=MacCodexAccountProcess.readFacts,
    knownExecutables:Set<String>=[],now:()->Date=Date.init) throws->[String:AssistantValue] {
    let target=URL(fileURLWithPath:home).standardizedFileURL
    guard home.hasPrefix("/"),target.path==home,!home.contains(where:{$0.isNewline}),home.utf8.count<=4096,
      target.resolvingSymlinksInPath().path==home else { throw failure("invalid_profile_home") }
    func snapshot() throws->[ProcessRow] {
      try rows(run("/bin/ps",["-axo","pid=,uid=,lstart=,comm="]),knownExecutables:knownExecutables)
    }
    let before=try snapshot();var owners:[AssistantValue]=[]
    for process in before {
      guard let facts=read(process.pid),let source=facts.codexHome ?? facts.home.map({URL(fileURLWithPath:$0).appendingPathComponent(".codex").path}) else {
        throw failure("process_home_unavailable")
      }
      guard URL(fileURLWithPath:source).resolvingSymlinksInPath().standardizedFileURL.path==home else { continue }
      owners.append(.object(["pid":.string(process.pid),"processIdentity":.string(process.identity),"executable":.string(process.executable)]))
    }
    guard try snapshot()==before else { throw failure("process_inventory_changed") }
    return ["home":.string(home),"complete":.bool(true),"owners":.array(owners),
      "observedAt":.number(now().timeIntervalSince1970*1000),"inspectedProcesses":.number(Double(before.count))]
  }
  /// Account-switch inventory for exact background owners. Only reviewed
  /// routing/feature flags are retained; arbitrary arguments and secrets stay
  /// transient in the process reader.
  static func allOwners(run:(String,[String]) throws->String=macTerminalResponseCommand,
    read:(String)->MacCodexAccountProcess.Facts?=MacCodexAccountProcess.readFacts,
    executablePath:(String)->String?=runningExecutable,
    now:()->Date=Date.init) throws->[String:AssistantValue] {
    func snapshot() throws->[ProcessRow] {try rows(run("/bin/ps",["-axo","pid=,uid=,lstart=,comm="]))}
    let before=try snapshot();var entries:[AssistantValue]=[]
    for process in before {
      guard let facts=read(process.pid),let home=facts.codexHome ?? facts.home.map({$0+"/.codex"}) else{throw failure("process_home_unavailable")}
      var entry:[String:AssistantValue]=["pid":.string(process.pid),"processLifetime":.string(process.identity),
        "executable":.string(process.executable),"authorizationHome":.string(home),"alternateAuthentication":.bool(facts.alternateAuthentication)]
      if facts.arguments.contains("app-server") {
        entry["kind"] = .string("app_server")
        do {entry["serverOptions"] = .array(try serverOptions(facts.arguments,managed:facts.accountTransitionId != nil).map(AssistantValue.string))}
        catch let error as MacCodexInputFailure {entry["reasonCode"] = .string(error.code)}
        // ps comm can be only "codex" for a PATH-launched server. Keep that
        // original column in the lifetime digest, but obtain the executable
        // for recreation from this exact live PID, never a current PATH lookup.
        if let executable=executablePath(process.pid),executable.hasPrefix("/"),
          executablePath(process.pid)==executable {
          entry["executable"] = .string(executable)
        } else {entry["reasonCode"] = .string("server_executable_unavailable")}
      } else {entry["kind"] = .string(facts.arguments.contains("exec") ? "exec":"codex")}
      entry["accountTransitionId"] = facts.accountTransitionId.map(AssistantValue.string) ?? .null
      entry["accountLaunchRequestId"] = facts.accountLaunchRequestId.map(AssistantValue.string) ?? .null
      entries.append(.object(entry))
    }
    guard try snapshot()==before else{throw failure("process_inventory_changed")}
    return ["complete":.bool(true),"processes":.array(entries),"observedAt":.number(now().timeIntervalSince1970*1000)]
  }
  static func runningExecutable(_ pid:String)->String? {
    guard let process=Int32(pid),process>0 else{return nil}
    var buffer=[CChar](repeating:0,count:4096)
    let count=buffer.withUnsafeMutableBytes{proc_pidpath(process,$0.baseAddress,UInt32($0.count))}
    guard count>0,count<buffer.count else{return nil}
    let executable=String(cString:buffer)
    guard executable.hasPrefix("/"),!executable.unicodeScalars.contains(where:CharacterSet.controlCharacters.contains),
      FileManager.default.isExecutableFile(atPath:executable) else{return nil}
    return executable
  }
  static func serverOptions(_ arguments:[String],managed:Bool) throws->[String] {
    guard arguments.count>1 else{throw failure("server_arguments_unavailable")}
    var options:[String]=[],found=false,index=1
    while index<arguments.count {
      let argument=arguments[index]
      if argument=="app-server",!found {found=true;index += 1;continue}
      if argument=="--listen" {guard index+1<arguments.count,arguments[index+1].hasPrefix("unix://"),
        !arguments[index+1].unicodeScalars.contains(where:CharacterSet.controlCharacters.contains) else{throw failure("server_transport_unsupported")};index += 2;continue}
      if argument=="--stdio" {throw failure("server_transport_unsupported")}
      if argument=="-c" || argument=="--config" {
        guard index+1<arguments.count else{throw failure("server_arguments_unavailable")};let value=arguments[index+1]
        if managed && value=="cli_auth_credentials_store=\"keyring\"" {index += 2;continue}
        if managed && value.hasPrefix("sqlite_home="),let data=String(value.dropFirst("sqlite_home=".count)).data(using:.utf8),
          let directory=try? JSONDecoder().decode(String.self,from:data),directory.hasPrefix("/"),
          !directory.unicodeScalars.contains(where:CharacterSet.controlCharacters.contains){index += 2;continue}
        guard value.range(of:#"^features\.[A-Za-z0-9_]+=(true|false)$"#,options:.regularExpression) != nil else{throw failure("server_configuration_override_unsupported")}
        options += ["-c",value];index += 2;continue
      }
      throw failure("server_launch_option_unsupported")
    }
    guard found else{throw failure("server_arguments_unavailable")};return options
  }
  private static func failure(_ code:String)->MacCodexInputFailure {
    .init(code:code,message:"The account profile activity check is incomplete (\(code)). Keep its runtime files unchanged and inspect again.")
  }
}
