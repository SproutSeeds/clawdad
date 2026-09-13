import XCTest
@testable import ClawDad

@MainActor final class MacCodexTitleSetupTests: XCTestCase {
  func panel(_ id: String, checked: Bool) -> String {
    "Configure Terminal Title\nSelect which items to display in the terminal title.\n› [\(checked ? "x":" ")] \(id) Description\nPress space to toggle; ←/→ to move; enter to confirm and close; esc to close"
  }
  func testOnlyExactLocalCommandOfferIsAccepted() {
    let offered = "history\n› /title\n\n /title  configure which items appear in the terminal title\n"
    XCTAssertTrue(MacCodexTitleSetup.offered(offered))
    for text in [offered + "› another draft", offered + "new output", offered.replacingOccurrences(of:"› /title",with:"› /title extra"), "A response about /title"] {
      XCTAssertFalse(MacCodexTitleSetup.offered(text))
    }
    XCTAssertNil(MacCodexTitleSetup.focusedRow("› [x] activity\nPress enter"))
  }
  func testEveryOptionIsObservedUncheckedBeforeOneLocalConfirmation() async throws {
    var items = [true,true,false,true], index = 0, sent = [String]()
    let ids = ["activity","thread-name","project-name","weekly-limit"]
    try await MacCodexTitleSetup.disable(read:{self.panel(ids[index],checked:items[index])},key:{ value in
      sent.append(value)
      if value == "space" { items[index].toggle() }
      if value == "down" { index = (index+1) % items.count }
    },journal:{_ in})
    XCTAssertEqual(items,[false,false,false,false])
    XCTAssertEqual(sent.filter{$0 == "enter"}.count,1); XCTAssertFalse(sent.contains("tab"))
  }
  func testFailedCheckboxAndChangedUIStopWithoutConfirmationOrRetry() async throws {
    var sent = [String]()
    do {
      try await MacCodexTitleSetup.disable(read:{self.panel("activity",checked:true)},key:{sent.append($0)},journal:{_ in})
      XCTFail("Failed observation must stop")
    } catch {}
    XCTAssertEqual(sent,["space"])
    sent=[]
    do { try await MacCodexTitleSetup.disable(read:{"other prompt"},key:{sent.append($0)},journal:{_ in}); XCTFail() } catch {}
    XCTAssertTrue(sent.isEmpty)
  }
}
