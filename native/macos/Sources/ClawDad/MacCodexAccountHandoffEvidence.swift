import Foundation
import CryptoKit
import ClawDadRemoteAssistProtocol

enum MacCodexAccountHandoffEvidence {
  static func digest(_ data:Data)->String { SHA256.hash(data:data).map{String(format:"%02x",$0)}.joined() }
  static func digest(_ text:String)->String {digest(Data(text.utf8))}
  static func failure(_ code:String)->MacCodexInputFailure {
    .init(code:code,message:"Account switching needs an exact, idle, recoverable Terminal input (\(code)). Existing work and its recovery record were preserved.")
  }
  /// A persistent parent shell must outlive Codex. In particular an `exec
  /// codex` tab cannot be stopped under the promise that its tab stays open.
  static func shell(_ table:String,agentPID:String?)->(pid:String,identity:String)? {
    let rows=table.split(separator:"\n").map{$0.split(maxSplits:9,whereSeparator:\.isWhitespace).map{$0.trimmingCharacters(in:.whitespaces)}}
    guard rows.allSatisfy({$0.count==10&&Int($0[0]) != nil&&Int($0[1]) != nil}),
      Set(rows.map{$0[0]}).count==rows.count else {return nil}
    let shells=rows.filter{["zsh","bash","sh"].contains(URL(fileURLWithPath:$0[9]).lastPathComponent.trimmingCharacters(in:CharacterSet(charactersIn:"-")))}
    let selected:[String]?
    if let agentPID {
      var cursor=agentPID,seen=Set<String>();var ancestors=[[String]]()
      while let row=rows.first(where:{$0[0]==cursor}),seen.insert(cursor).inserted {
        ancestors.append(row);cursor=row[1]
      }
      let parents=ancestors.dropFirst().filter{row in shells.contains(where:{$0[0]==row[0]})}
      selected=parents.first
    } else {
      let foreground=shells.filter{$0[2]==$0[3]}
      selected=foreground.count==1 ? foreground.first:nil
    }
    guard let selected else {return nil}
    // Exclude foreground group and process status, which change when a child
    // exits. PID, parent PID, start time and executable fence shell reuse.
    return (selected[0],"shell-"+digest((selected.prefix(2)+selected.dropFirst(4)).joined(separator:"|")))
  }
  static func parentShell(tty:String,agentPID:String?)->(pid:String,identity:String)? {
    guard tty.range(of:#"^/dev/tty[A-Za-z0-9]+$"#,options:.regularExpression) != nil else{return nil}
    return try? shell(macTerminalResponseCommand("/bin/ps",["-t",String(tty.dropFirst(5)),"-o","pid=,ppid=,pgid=,tpgid=,lstart=,comm="]),agentPID:agentPID)
  }
  /// Hash accepted user content and turn boundaries, not resume metadata or
  /// local /status output. Bound I/O and reject partial writes. No content is
  /// returned or copied into diagnostics.
  static func acceptedHistory(_ url:URL) throws -> String {
    let before=try FileManager.default.attributesOfItem(atPath:url.path)
    guard (before[.size] as? NSNumber)?.int64Value ?? Int64.max <= 128*1024*1024 else {throw failure("history_too_large_for_switch_verification")}
    let handle=try FileHandle(forReadingFrom:url);defer{try? handle.close()}
    var pending=Data(),hasher=SHA256(),total=0
    while let chunk=try handle.read(upToCount:512*1024),!chunk.isEmpty {
      total += chunk.count;guard total<=128*1024*1024 else{throw failure("history_changed")};pending.append(chunk)
      while let end=pending.firstIndex(of:10) {
        let line=pending.prefix(upTo:end);pending.removeSubrange(...end)
        guard let row=try? JSONSerialization.jsonObject(with:line) as? [String:Any],let payload=row["payload"] as? [String:Any] else{throw failure("history_unreadable")}
        if row["type"] as? String=="event_msg",["task_started","user_message","task_complete","turn_aborted"].contains(payload["type"] as? String ?? "") {
          hasher.update(data:line);hasher.update(data:Data([10]))
        } else if row["type"] as? String=="response_item",payload["role"] as? String=="user" {
          hasher.update(data:line);hasher.update(data:Data([10]))
        }
      }
      guard pending.count<=8*1024*1024 else{throw failure("history_event_too_large")}
    }
    let after=try FileManager.default.attributesOfItem(atPath:url.path)
    guard pending.isEmpty,MacAssistantSubmissionLog.identity(before)==MacAssistantSubmissionLog.identity(after),
      (before[.size] as? NSNumber)==(after[.size] as? NSNumber) else{throw failure("history_changed")}
    return hasher.finalize().map{String(format:"%02x",$0)}.joined()
  }
  static func quoted(_ value:String)->String {"'"+value.replacingOccurrences(of:"'",with:"'\\''")+"'"}
  static func launchCommand(source:[String:AssistantValue],target:[String:AssistantValue],requestId:String) throws -> String {
    func absolute(_ value:String?)->String? {
      guard let value,value.hasPrefix("/"),value.utf8.count<=4096,!value.unicodeScalars.contains(where:CharacterSet.controlCharacters.contains) else{return nil};return value
    }
    guard requestId.range(of:#"^[A-Za-z0-9_.:-]{1,160}$"#,options:.regularExpression) != nil,
      let executable=absolute(source["executable"]?.string),let directory=absolute(source["directory"]?.string),
      let home=absolute(target["authorizationHome"]?.string),let sqlite=absolute(target["sqliteHome"]?.string),
      let session=source["sessionId"]?.string,UUID(uuidString:session) != nil,
      let model=source["model"]?.string,model.range(of:#"^[A-Za-z0-9_.:/-]{1,160}$"#,options:.regularExpression) != nil,
      let effort=source["reasoningEffort"]?.string,effort.range(of:#"^[a-z_]{1,40}$"#,options:.regularExpression) != nil,
      let options=source["resumeOptions"]?.array,options.allSatisfy({$0.string != nil}) else{throw failure("resume_configuration_unverified")}
    let arguments=options.compactMap(\.string)
    guard try MacCodexAccountProcess.options([executable]+arguments)==arguments else{throw failure("resume_options_changed")}
    // A resumed owner's argv already includes the prior explicit model/effort.
    // Clap rejects repeated --model flags; replace these two values with the
    // verified live configuration while retaining every other reviewed option.
    var preserved:[String]=[],index=0
    while index<arguments.count {
      if ["--model","-m"].contains(arguments[index]) {index += 2;continue}
      if ["-c","--config"].contains(arguments[index]),arguments[index+1].hasPrefix("model_reasoning_effort=") {index += 2;continue}
      preserved.append(arguments[index]);index += 1
    }
    // Child-scoped routing. Never change shell/global authentication or replay
    // an initial prompt/image. Explicit model values override old launch flags.
    let env=["OPENAI_API_KEY","CODEX_API_KEY","CODEX_ACCESS_TOKEN","OPENAI_BASE_URL","CODEX_HOME","CODEX_SQLITE_HOME","CLAWDAD_CODEX_HOME"].flatMap{["-u",$0]}
    let flags=["CODEX_HOME="+home,"CLAWDAD_ACCOUNT_TRANSITION_ID="+requestId,executable,"resume",session,"--cd",directory]+preserved +
      ["--model",model,"-c","model_reasoning_effort=\""+effort+"\"","-c","cli_auth_credentials_store=\"keyring\"","-c","sqlite_home="+jsonString(sqlite)]
    return "cd -- "+quoted(directory)+" && /usr/bin/env "+(env+flags).map(quoted).joined(separator:" ")
  }
  private static func jsonString(_ value:String)->String {
    // Codex -c parses TOML strings. JSON's optional \/ slash escape is not a
    // TOML escape: the CLI otherwise falls back to a literal, relative path.
    let encoder=JSONEncoder();encoder.outputFormatting=[.withoutEscapingSlashes]
    return String(data:try! encoder.encode(value),encoding:.utf8)!
  }
}
