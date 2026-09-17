import Foundation

/// Evidence journal, separate from manually saved setups. A TTY alone is never
/// historical authority. Resuming an exited agent additionally requires its
/// native CLI exit receipt at the current empty shell prompt, in the same login
/// lifetime. A new Terminal process/TTY reuse cannot inherit an old binding.
final class MainWorkspaceAgentBindings {
  struct Record: Codable, Equatable {
    var tty:String
    var lifetime:String
    var process:String
    var directory:String
    var sessionId:String
    var path:String
    var executable:String
  }
  let file:URL
  init(file:URL) { self.file=file }
  func remember(_ record:Record) throws {
    var rows=(try? JSONDecoder().decode([Record].self,from:Data(contentsOf:file))) ?? []
    if rows.last(where:{$0.tty==record.tty})==record { return }
    rows.removeAll{$0.tty==record.tty};rows.append(record);rows=Array(rows.suffix(128))
    try FileManager.default.createDirectory(at:file.deletingLastPathComponent(),withIntermediateDirectories:true,attributes:[.posixPermissions:0o700])
    try JSONEncoder().encode(rows).write(to:file,options:.atomic)
    try FileManager.default.setAttributes([.posixPermissions:0o600],ofItemAtPath:file.path)
  }
  func exited(tty:String,lifetime:String,screen:String) -> Record? {
    guard let record=known(tty:tty,lifetime:lifetime),
      Self.exitReceipt(screen,sessionId:record.sessionId) else { return nil }
    return record
  }
  func known(tty:String,lifetime:String) -> Record? {
    (try? JSONDecoder().decode([Record].self,from:Data(contentsOf:file)))?.last(where:{$0.tty==tty && $0.lifetime==lifetime})
  }
  static func exitReceipt(_ screen:String,sessionId:String) -> Bool {
    guard UUID(uuidString:sessionId) != nil,
      let draft=MacAssistantShellDraft.read(screen),draft.text.isEmpty else { return false }
    let lines=screen.components(separatedBy:.newlines).filter{!$0.trimmingCharacters(in:.whitespaces).isEmpty}
    guard lines.count>=2 else { return false }
    // Match a complete final native exit block, including Codex's multiline
    // command and optional named-picker hint. Display wrapping may split words
    // or the UUID. The exact UUID remains mandatory; a title is never identity.
    // The bounded suffix must end at this empty shell prompt, with no intervening
    // shell prompt/command that could turn an older exit into current evidence.
    let body=Array(lines.dropLast().suffix(32))
    let legacy="Tocontinuethissession,runcodexresume\(sessionId)"
    let command="Tocontinuethissession,run:codexresume\(sessionId)"
    let picker="Orruncodexresumeandselect"
    for start in body.indices {
      let block=body[start...]
      guard !block.contains(where:{MacAssistantShellDraft.read($0) != nil}) else { continue }
      let compact=block.joined().filter{!$0.isWhitespace}
      if compact==legacy || compact==command { return true }
      if compact.hasPrefix(command+picker) {
        let title=compact.dropFirst(command.count+picker.count)
        if title.count>1 && title.last==".", !title.contains("Tocontinuethissession,run"),
          !title.contains(picker) { return true }
      }
    }
    return false
  }
}
