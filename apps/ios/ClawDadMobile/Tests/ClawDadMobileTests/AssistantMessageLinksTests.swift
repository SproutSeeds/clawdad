import XCTest
@testable import ClawDadMobile

final class AssistantMessageLinksTests: XCTestCase {
  private let message = "🦞 Example business\nPhone: (415) 555-0100\nAddress: 123 Main Street, San Francisco, CA 94105"

  func testDataDetectionPreservesTextAndLinksPhoneAndCompleteStreetAddress() throws {
    let text = AssistantMessageLinks.text(message)
    XCTAssertEqual(String(text.characters), message)
    let links = text.runs.compactMap { run -> (String, URL)? in
      guard let url = run.link else { return nil }
      return (String(text[run.range].characters), url)
    }
    XCTAssertEqual(links.count, 2)
    XCTAssertEqual(links.first?.0, "(415) 555-0100")
    XCTAssertEqual(links.first?.1.scheme, "tel")
    XCTAssertEqual(links.last?.0, "123 Main Street, San Francisco, CA 94105")
    let maps = AssistantMessageLinks.destinations(for: try XCTUnwrap(links.last?.1))
    XCTAssertEqual(maps.map(\.scheme), ["comgooglemaps", "https"])
    XCTAssertEqual(maps.last?.host, "maps.apple.com")
    for url in maps {
      XCTAssertEqual(URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first?.value, links.last?.0)
    }
  }

  func testOrdinaryNumbersAndIncompleteLocationsRemainPlainText() {
    let text = AssistantMessageLinks.text("Build 61 has 123 tests; the cost is $45. The city is Chicago.")
    XCTAssertTrue(text.runs.allSatisfy { $0.link == nil })
  }

  func testMapQueryCannotInjectExtraParameters() throws {
    var input = URLComponents(string: "clawdad-assistant-address://open")!
    input.queryItems = [.init(name: "q", value: "12 Rue de l’Église #2 & Main + North, Paris")]
    for url in AssistantMessageLinks.destinations(for: try XCTUnwrap(input.url)) {
      let query = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems
      XCTAssertEqual(query?.count, 1)
      XCTAssertEqual(query?.first?.value, input.queryItems?.first?.value)
    }
    XCTAssertTrue(AssistantMessageLinks.destinations(for: URL(string: "clawdad-assistant-address://other?q=x")!).isEmpty)
  }

  @MainActor func testGoogleMapsPreferredAndAppleUsedIfUnavailableOrLaunchFails() async throws {
    let address = try XCTUnwrap(AssistantMessageLinks.text(message).runs.compactMap(\.link).last)
    for (installed, succeeds, expected) in [(true, true, ["comgooglemaps"]),
      (false, false, ["https"]), (true, false, ["comgooglemaps", "https"])] {
      var attempts: [String] = []
      let opened = await AssistantMessageLinks.open(address, canOpen: { _ in installed }, openURL: { url in
        attempts.append(url.scheme!)
        return url.scheme == "https" || succeeds
      })
      XCTAssertTrue(opened)
      XCTAssertEqual(attempts, expected)
    }
  }

  @MainActor func testPhoneHandsOffOnceWithoutOpeningMapsAndReportsUnavailableHandler() async throws {
    let phone = try XCTUnwrap(AssistantMessageLinks.text(message).runs.compactMap(\.link).first)
    var attempts: [URL] = []
    let opened = await AssistantMessageLinks.open(phone, canOpen: { _ in XCTFail(); return false }, openURL: {
      attempts.append($0); return false
    })
    XCTAssertFalse(opened)
    XCTAssertEqual(attempts, [phone])
    XCTAssertEqual(phone.scheme, "tel")
  }
}
