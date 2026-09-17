// Retired Terminal account controller: retained for historical regression fixtures only.
#if DEBUG
import Foundation

/// Parses only the response to a deliberately dispatched local /status command.
/// The caller must prove that command, its exact owner and a subsequent empty
/// composer; historical panels or agent prose are never identity authority.
struct MacCodexAccountStatus:Equatable,Codable {
  var version:String
  var email:String
  var plan:String
  var model:String
  var reasoningEffort:String
  var provider:String
  var directory:String
  var sessionId:String
  var permissions:String

  static func read(_ text:String,expectedSession:String,expectedDirectory:String,home:String)->Self? {
    func captures(_ pattern:String,_ value:String)->[String]? {
      guard let regex=try? NSRegularExpression(pattern:pattern),let match=regex.firstMatch(in:value,range:NSRange(value.startIndex...,in:value)) else {return nil}
      return (1..<match.numberOfRanges).compactMap{Range(match.range(at:$0),in:value).map{String(value[$0])}}
    }
    let lines=text.components(separatedBy:.newlines).map{$0.trimmingCharacters(in:.whitespaces)}
    guard let start=lines.lastIndex(where:{$0.contains(">_ OpenAI Codex (v")}),
      let version=captures(#">_ OpenAI Codex \(v([0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?)\)"#,lines[start])?.first else {return nil}
    var values:[String:String]=[:]
    let required:Set<String>=["Account","Model","Model provider","Directory","Permissions","Session"]
    for line in lines.dropFirst(start+1) {
      if line.hasPrefix("›") || line.hasPrefix("╰") {break}
      guard line.hasPrefix("│") else {continue}
      let inside=String(line.dropFirst()).trimmingCharacters(in:CharacterSet.whitespaces.union(CharacterSet(charactersIn:"│")))
      guard let field=captures(#"^([A-Za-z. ]+):\s*(.*?)\s*$"#,inside),field.count==2,required.contains(field[0]) else {continue}
      guard values[field[0]]==nil else {return nil};values[field[0]]=field[1]
    }
    guard required.isSubset(of:Set(values.keys)),
      let account=captures(#"^([^\s@]+@[^\s@]+\.[^\s@]+) \(([^()\r\n]{1,80})\)$"#,values["Account"]!),account.count==2,
      let model=captures(#"^([A-Za-z0-9_.:/-]{1,160}) \(reasoning ([a-z_]+), summaries [a-z_]+\)$"#,values["Model"]!),model.count==2,
      let session=values["Session"],UUID(uuidString:session) != nil,session.lowercased()==expectedSession.lowercased(),
      let raw=values["Directory"] else {return nil}
    let directory=raw.hasPrefix("~/") ? home+String(raw.dropFirst()):raw
    guard directory==expectedDirectory,values["Model provider"]=="openai" else {return nil}
    return .init(version:version,email:account[0].lowercased(),plan:account[1],model:model[0],reasoningEffort:model[1],
      provider:values["Model provider"]!,directory:directory,sessionId:session.lowercased(),permissions:values["Permissions"]!)
  }
}

#endif
