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
      let fields=line.split(maxSplits:7,whereSeparator:\.isWhitespace).map(String.init)
      guard fields.count==8,let process=Int32(fields[0]),process>0,let owner=uid_t(fields[1]) else {
        throw failure("process_inventory_incomplete")
      }
      guard owner==uid else { continue }
      let executable=fields[7]
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
  private static func failure(_ code:String)->MacCodexInputFailure {
    .init(code:code,message:"The account profile activity check is incomplete (\(code)). Keep its runtime files unchanged and inspect again.")
  }
}
