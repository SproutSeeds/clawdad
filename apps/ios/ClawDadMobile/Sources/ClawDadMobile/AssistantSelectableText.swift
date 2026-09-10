import SwiftUI

/// Selection belongs to the visible conversation, independently of its call and composer.
@MainActor
final class AssistantMessageSelection: ObservableObject {
  @Published private(set) var activeID: String?
  func changed(_ id: String, active: Bool) {
    if active { activeID = id }
    else if activeID == id { activeID = nil }
  }
}

#if canImport(UIKit)
import UIKit

@MainActor
final class AssistantMessageTextView: UITextView, UITextViewDelegate {
  var selectionChanged: (Bool) -> Void = { _ in }
  var openLink: (URL) -> Void = { _ in }
  private var pendingText: NSAttributedString?
  private var touching = false
  private var applying = false
  private var announcedSelection = false
  var renderedSource: String?
  var renderedFontSize: CGFloat?

  init() {
    super.init(frame: .zero, textContainer: nil)
    isEditable = false
    isSelectable = true
    isScrollEnabled = false
    backgroundColor = .clear
    textContainerInset = .zero
    textContainer.lineFragmentPadding = 0
    adjustsFontForContentSizeCategory = true
    setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
    delegate = self
    // Retain the system's Copy, Look Up, Translate and Share actions. Read-only
    // text excludes Cut, Paste, replacement and writing back into the message.
  }
  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
  var holdsSelection: Bool { touching || selectedRange.length > 0 }

  func display(_ value: NSAttributedString) {
    guard !attributedText.isEqual(to: value) else { pendingText = nil; return }
    if holdsSelection { pendingText = value; return }
    applying = true
    attributedText = value
    selectedRange = NSRange(location: 0, length: 0)
    applying = false
    invalidateIntrinsicContentSize()
  }
  private func selectionDidChange() {
    guard !applying else { return }
    let active = holdsSelection
    if announcedSelection != active { announcedSelection = active; selectionChanged(active) }
    if !active, let pendingText { self.pendingText = nil; display(pendingText) }
  }
  func textViewDidChangeSelection(_ textView: UITextView) { selectionDidChange() }
  func textView(_ textView: UITextView, shouldChangeTextIn range: NSRange, replacementText text: String) -> Bool { false }
  func textView(_ textView: UITextView, shouldInteractWith URL: URL, in characterRange: NSRange,
    interaction: UITextItemInteraction) -> Bool {
    if interaction == .invokeDefaultAction { openLink(URL); return false }
    return true
  }
  override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
    touching = true; selectionDidChange(); super.touchesBegan(touches, with: event)
  }
  override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
    super.touchesEnded(touches, with: event); touching = false; selectionDidChange()
  }
  override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) {
    super.touchesCancelled(touches, with: event); touching = false; selectionDidChange()
  }
  override func resignFirstResponder() -> Bool {
    let resigned = super.resignFirstResponder()
    if resigned { touching = false; selectedRange = NSRange(location: 0, length: 0); selectionDidChange() }
    return resigned
  }
}

struct AssistantSelectableText: UIViewRepresentable {
  let text: String
  var id: String = "message"
  var selection: AssistantMessageSelection? = nil
  @Environment(\.openURL) private var openURL
  @Environment(\.sizeCategory) private var sizeCategory

  func makeUIView(context: Context) -> AssistantMessageTextView {
    let view = AssistantMessageTextView()
    view.accessibilityIdentifier = "clawdad.assistant.text.\(id)"
    return view
  }
  func updateUIView(_ view: AssistantMessageTextView, context: Context) {
    view.openLink = { openURL($0) }
    view.selectionChanged = { active in
      DispatchQueue.main.async { selection?.changed(id, active: active) }
    }
    let font = UIFont.preferredFont(forTextStyle: .body)
    // Calls refresh several times a second. Detect links/format a large message
    // only when its source or Dynamic Type size actually changes.
    guard view.renderedSource != text || view.renderedFontSize != font.pointSize else { return }
    view.renderedSource = text; view.renderedFontSize = font.pointSize
    // Long messages remain complete native selectable documents. A bounded
    // viewport prevents enormous outer chat rows and keeps actions reachable.
    view.isScrollEnabled = text.utf8.count > 8_192
    view.accessibilityHint = view.isScrollEnabled ? "Scroll within this message to read its complete text. Text selection and Copy are available." : nil
    let content = NSMutableAttributedString(AssistantMessageLinks.text(text))
    let full = NSRange(location: 0, length: content.length)
    content.addAttributes([.font: font, .foregroundColor: UIColor(ClawDadTheme.cream)], range: full)
    // Preserve every source character, including lists and code fences, so the
    // selected range and copied passage always refer to the same text.
    if let code = try? NSRegularExpression(pattern: "(?s)```.*?(?:```|$)|`[^`\\n]+`") {
      for match in code.matches(in: text, range: full) {
        content.addAttribute(.font, value: UIFont.monospacedSystemFont(ofSize: font.pointSize, weight: .regular), range: match.range)
      }
    }
    view.linkTextAttributes = [.foregroundColor: UIColor(ClawDadTheme.gold), .underlineStyle: NSUnderlineStyle.single.rawValue]
    view.display(content)
  }
  func sizeThatFits(_ proposal: ProposedViewSize, uiView: AssistantMessageTextView, context: Context) -> CGSize? {
    guard let width = proposal.width, width > 0 else { return nil }
    if uiView.isScrollEnabled {
      return CGSize(width: width, height: min(420, (uiView.renderedFontSize ?? 20) * 14))
    }
    return CGSize(width: width, height: ceil(uiView.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude)).height))
  }
  static func dismantleUIView(_ view: AssistantMessageTextView, coordinator: ()) {
    _ = view.resignFirstResponder(); view.selectionChanged(false)
  }
}
#else
struct AssistantSelectableText: View {
  let text: String
  var id: String = "message"
  var selection: AssistantMessageSelection? = nil
  var body: some View { Text(AssistantMessageLinks.text(text)).textSelection(.enabled) }
}
#endif
