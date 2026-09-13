import CryptoKit
import ClawDadRemoteAssistProtocol
import Foundation

/// An observed interactive choice is a different capability from a composer.
/// The process and native input are checked by MacAssistantTerminalInput.
struct MacAssistantTerminalPrompt: Equatable {
  struct Choice: Equatable {
    let id: String
    let label: String
  }
  let kind: String
  let text: String
  let choices: [Choice]
  let selected: String?
  let directory: String?
  let lineInput: Bool
  var id: String {
    let material = [kind, directory ?? "", text].joined(separator: "\n")
    return SHA256.hash(data: Data(material.utf8)).map { String(format: "%02x", $0) }.joined()
  }
  var fields: [String: AssistantValue] {
    ["id": .string(id), "adapter": .string("terminal-observed-choice-v1"), "kind": .string(kind),
      "text": .string(text), "directory": directory.map(AssistantValue.string) ?? .null,
      "selectedChoiceId": selected.map(AssistantValue.string) ?? .null,
      "choices": .array(choices.map { .object(["id": .string($0.id), "label": .string($0.label)]) }),
      "requiresAuthorization": .bool(true), "canRespond": .bool(lineInput || selected != nil),
      "guidance": .string("Use respond_terminal_prompt with this exact prompt ID and choice ID. Quote Cody's authorizing instruction; do not ask again when that instruction already covers this choice. Trust loads project configuration, hooks and policies. A prompt decision never submits a conversation turn.")]
  }

  static func read(_ screen: String, codexDirectory: String?, foregroundShell: Bool) -> Self? {
    guard !foregroundShell else { return nil }
    let lines = screen.components(separatedBy: .newlines).map { $0.trimmingCharacters(in: .whitespaces) }
    let nonempty = lines.indices.filter { !lines[$0].isEmpty }
    guard let end = nonempty.last else { return nil }
    // Passwords, sign-in challenges, and consent outside a Terminal decision
    // retain their own user/platform flows, even when they resemble a menu.
    let tail = nonempty.suffix(12).map { lines[$0] }.joined(separator: "\n")
    guard tail.range(of: #"(?i)password:|passphrase:|verification code|one.time code|sign in with|log in with|enter.*api.key"#, options: .regularExpression) == nil else { return nil }
    if let match = lines[end].range(of: #"\[(?:[yY]/[nN]|[yY]es/[nN]o)\]\s*[:?]?\s*$"#, options: .regularExpression) {
      let question = String(lines[end][..<match.lowerBound]).trimmingCharacters(in: .whitespaces)
      guard !question.isEmpty, question.count <= 1000 else { return nil }
      return Self(kind: "line_confirmation", text: lines[end],
        choices: [.init(id: "yes", label: "Yes"), .init(id: "no", label: "No")],
        selected: nil, directory: nil, lineInput: true)
    }
    let pattern = #"^(?:(›|❯|>)\s*)?(\d{1,2})[.)]\s+(.+)$"#
    let regex = try! NSRegularExpression(pattern: pattern)
    var options: [(Int, Choice, Bool)] = []
    for index in nonempty {
      let line = lines[index] as NSString
      guard let match = regex.firstMatch(in: lines[index], range: NSRange(location: 0, length: line.length)) else { continue }
      options.append((index, .init(id: line.substring(with: match.range(at: 2)), label: line.substring(with: match.range(at: 3))), match.range(at: 1).location != NSNotFound))
    }
    guard let last = options.last, last.0 < end, end - last.0 <= 12,
      lines[(last.0 + 1)...end].contains(where: { $0.range(of: #"(?i)^(?:press )?enter to (?:confirm|continue|select|submit)|^use .*enter.*(?:select|confirm)"#, options: .regularExpression) != nil }) else { return nil }
    // Select the final contiguous numbered menu, never historical choices.
    var start = options.count - 1
    while start > 0, Int(options[start].1.id) == Int(options[start - 1].1.id).map({ $0 + 1 }), options[start].0 - options[start - 1].0 <= 6 { start -= 1 }
    let menu = Array(options[start...])
    guard (2...20).contains(menu.count), menu.first?.1.id == "1", menu.filter({ $0.2 }).count == 1,
      !lines[(last.0 + 1)...end].contains(where: { $0.hasPrefix("›") }) else { return nil }
    let first = menu[0].0
    let trust = lines[..<first].lastIndex(where: { $0.hasPrefix("Do you trust the contents of this directory?") })
    let heading = trust ?? lines[..<first].lastIndex(where: {
      $0.range(of: #"(?i)^(?:select|choose|would you like|do you want|allow|continue\?|permission|resume)\b"#, options: .regularExpression) != nil
    })
    guard let heading, first - heading <= 35 else { return nil }
    if trust != nil {
      guard let directory = codexDirectory, lines[max(0, heading - 3)..<first].contains(where: {
        var candidate = $0
        for prefix in ["> You are in ", "You are in "] where candidate.hasPrefix(prefix) { candidate = String(candidate.dropFirst(prefix.count)) }
        if candidate.hasPrefix("\""), candidate.hasSuffix("\"") { candidate = String(candidate.dropFirst().dropLast()) }
        return candidate.hasPrefix("/") && URL(fileURLWithPath: candidate).resolvingSymlinksInPath().path == URL(fileURLWithPath: directory).resolvingSymlinksInPath().path
      }),
        menu[0].1.label == "Yes, continue", menu.contains(where: { $0.1.label.hasPrefix("No,") }) else { return nil }
    }
    let canonical = lines[heading...end].map { line -> String in
      guard let match = regex.firstMatch(in: line, range: NSRange(location: 0, length: (line as NSString).length)), match.range(at: 1).location != NSNotFound else { return line }
      return String(line.dropFirst()).trimmingCharacters(in: .whitespaces)
    }.joined(separator: "\n")
    return Self(kind: trust != nil ? "codex_directory_trust" : "numbered_menu", text: canonical,
      choices: menu.map(\.1), selected: menu.first(where: { $0.2 })?.1.id,
      directory: trust != nil ? codexDirectory : nil, lineInput: false)
  }
}

func assistantTerminalFailure(_ code: String, _ message: String, keySent: Bool? = false,
  fields: [String: AssistantValue] = [:]) -> MacAssistantSubmissionFailure {
  var result = fields
  result["reasonCode"] = .string(code)
  result["keySent"] = keySent.map(AssistantValue.bool) ?? .null
  result["submitted"] = .bool(false)
  result["turnAccepted"] = .bool(false)
  return .init(message: message, fields: result)
}

/// Dispatch is never retried. Re-observation can wait, preserving the exact
/// request receipt even if confirmation is delayed or the transport disappears.
@MainActor
func assistantRespondToPrompt(_ expected: MacAssistantTerminalPrompt, choiceId: String,
  read: () async throws -> MacAssistantTerminalPrompt?,
  prepare: () async throws -> Void,
  key: (String) async -> Bool,
  verifyLineChoice: (String) async throws -> Bool = { _ in false },
  observeResult: () async throws -> [String: AssistantValue]?,
  wait: () async throws -> Void = { try await Task.sleep(for: .milliseconds(150)) }
) async throws -> [String: AssistantValue] {
  guard let desired = expected.choices.firstIndex(where: { $0.id == choiceId }) else {
    throw assistantTerminalFailure("unsupported_choice", "Choose an exact option returned by this prompt inspection. No key was sent.")
  }
  guard let current = try await read(), current.id == expected.id, current.selected == expected.selected else {
    throw assistantTerminalFailure("prompt_changed", "The prompt or selected choice changed. Inspect the exact input again; no decision was sent.")
  }
  try await prepare()
  var count = 0
  var decisionSent = false
  func press(_ name: String) async throws {
    guard await key(name) else {
      throw assistantTerminalFailure("dispatch_failed", "The native prompt key could not be sent. Inspect the original receipt before another action.", keySent: count > 0,
        fields: ["decisionSent": .bool(false), "keysDispatched": .number(Double(count))])
    }
    count += 1
  }
  do {
  if expected.lineInput {
    try await press(choiceId == "yes" ? "y" : "n")
    guard try await verifyLineChoice(choiceId == "yes" ? "y" : "n") else {
      throw assistantTerminalFailure("line_choice_unverified", "The selected letter was sent, but this line prompt did not expose it safely. Enter was not sent. Inspect the original receipt and input.", keySent: true,
        fields: ["decisionSent": .bool(false), "keysDispatched": .number(Double(count))])
    }
  } else {
    guard let selected = expected.choices.firstIndex(where: { $0.id == expected.selected }) else {
      throw assistantTerminalFailure("selection_unavailable", "This menu does not expose its selected option. Use the visible Terminal control.")
    }
    var index = selected
    while index != desired {
      let direction = index < desired ? 1 : -1
      try await press(direction == 1 ? "down" : "up")
      index += direction
      var verified = false
      for _ in 0..<8 {
        if let next = try await read(), next.id == expected.id, next.selected == expected.choices[index].id { verified = true; break }
        try await wait()
      }
      guard verified else { throw assistantTerminalFailure("selection_changed", "The selected menu option could not be verified. Enter was not sent; inspect this receipt.", keySent: true, fields: ["decisionSent": .bool(false), "keysDispatched": .number(Double(count))]) }
    }
    guard let final = try await read(), final.id == expected.id, final.selected == choiceId else {
      throw assistantTerminalFailure("prompt_changed", "The prompt changed before its decision. Enter was not sent.", keySent: count > 0, fields: ["decisionSent": .bool(false)])
    }
  }
  try await press("enter")
  decisionSent = true
  for _ in 0..<24 {
    do {
      if var result = try await observeResult() {
        result.merge(["decisionSent": .bool(true), "keySent": .bool(true), "keysDispatched": .number(Double(count)),
          "promptId": .string(expected.id), "choiceId": .string(choiceId), "submitted": .bool(false),
          "turnAccepted": .bool(false), "taskCompletionVerified": .bool(false)]) { _, new in new }
        return result
      }
    } catch { break }
    try await wait()
  }
  throw assistantTerminalFailure("delivery_uncertain", "The prompt decision was sent once, but its result is not verified. Inspect this receipt and the exact Terminal state; do not repeat the decision.", keySent: true,
    fields: ["decisionSent": .bool(true), "keysDispatched": .number(Double(count)), "promptId": .string(expected.id), "choiceId": .string(choiceId), "verification": .string("decision-sent-awaiting-observation")])
  } catch {
    var fields = (error as? MacAssistantSubmissionFailure)?.fields ?? [:]
    fields["keysDispatched"] = .number(Double(count)); fields["decisionSent"] = .bool(decisionSent)
    fields["promptId"] = .string(expected.id); fields["choiceId"] = .string(choiceId)
    throw assistantTerminalFailure(decisionSent ? "delivery_uncertain" : fields["reasonCode"]?.string ?? "prompt_state_changed",
      error.localizedDescription, keySent: count > 0, fields: fields)
  }
}
