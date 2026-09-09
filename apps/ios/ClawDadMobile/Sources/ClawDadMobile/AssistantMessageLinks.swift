import Foundation
import SwiftUI
#if os(iOS)
import UIKit
#endif

/// Detect contacts on-device while retaining the response's original wording.
enum AssistantMessageLinks {
  static func text(_ source: String) -> AttributedString {
    var result = AttributedString(source)
    guard let detector = try? NSDataDetector(types:
      NSTextCheckingResult.CheckingType.phoneNumber.rawValue | NSTextCheckingResult.CheckingType.address.rawValue
        | NSTextCheckingResult.CheckingType.link.rawValue)
    else { return result }
    for match in detector.matches(in: source, range: NSRange(source.startIndex..., in: source)) {
      guard let range = Range(match.range, in: source),
        let start = AttributedString.Index(range.lowerBound, within: result),
        let end = AttributedString.Index(range.upperBound, within: result) else { continue }
      let url: URL?
      if match.resultType == .phoneNumber, let number = match.phoneNumber {
        // Retain international prefixes and extensions; encode URL metacharacters.
        var components = URLComponents()
        components.scheme = "tel"
        components.path = number
        url = components.url
      } else if match.resultType == .address, match.addressComponents?[.street] != nil {
        var components = URLComponents()
        components.scheme = "clawdad-assistant-address"
        components.host = "open"
        components.queryItems = [URLQueryItem(name: "q", value: String(source[range]))]
        url = components.url
      } else if match.resultType == .link { url = match.url }
      else { url = nil }
      if let url { result[start..<end].link = url }
    }
    return result
  }

  static func destinations(for url: URL) -> [URL] {
    if url.scheme == "tel" { return [url] }
    guard url.scheme == "clawdad-assistant-address", url.host == "open",
      let address = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?
        .first(where: { $0.name == "q" })?.value,
      !address.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return [] }
    return ["comgooglemaps://", "https://maps.apple.com/"].compactMap { base in
      var components = URLComponents(string: base)
      components?.queryItems = [URLQueryItem(name: "q", value: address)]
      return components?.url
    }
  }

  @MainActor static func open(_ url: URL, canOpen: (URL) -> Bool,
    openURL: (URL) async -> Bool) async -> Bool {
    for destination in destinations(for: url) {
      if destination.scheme == "comgooglemaps", !canOpen(destination) { continue }
      if await openURL(destination) { return true }
    }
    return false
  }
}

struct AssistantResponseText: View {
  let text: String
  var id: String = "response"
  var selection: AssistantMessageSelection? = nil
  @State private var failed = false
  #if DEBUG
  @State private var previewDestination = ""
  #endif

  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      AssistantSelectableText(text: text, id: id, selection: selection)
        .environment(\.openURL, OpenURLAction { url in
          guard !AssistantMessageLinks.destinations(for: url).isEmpty else { return .systemAction }
          Task { @MainActor in
            #if DEBUG
            if ProcessInfo.processInfo.arguments.contains("--clawdad-assistant-links-test") {
              _ = await AssistantMessageLinks.open(url, canOpen: { _ in
                !ProcessInfo.processInfo.arguments.contains("--clawdad-assistant-no-google")
              }, openURL: { destination in
                previewDestination = destination.absoluteString
                return true
              })
              return
            }
            #endif
            #if os(iOS)
            failed = await !AssistantMessageLinks.open(url,
              canOpen: { UIApplication.shared.canOpenURL($0) },
              openURL: { await UIApplication.shared.open($0) })
            #endif
          }
          return .handled
        })
      #if DEBUG
      if !previewDestination.isEmpty {
        Text(previewDestination).font(.caption)
          .accessibilityIdentifier("clawdad.assistant.link-destination")
      }
      #endif
    }
    .alert("Couldn’t open this link", isPresented: $failed) {
      Button("OK", role: .cancel) {}
    } message: { Text("You can still select and copy the phone number or address.") }
  }
}
