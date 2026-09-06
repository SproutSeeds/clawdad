import ClawDadRemoteAssistProtocol
import XCTest
@testable import ClawDadMobile

final class RemoteTerminalWindowGroupsTests: XCTestCase {
  func testTwoWindowsKeepTwentyDuplicateTabsInPhysicalOrder() {
    let first = (1...20).reversed().map { position in
      RemoteTerminalTabDescriptor(id: "a-\(position)", title: "same-directory", detail: "Tab \(position)",
        isSelected: position == 12, isBusy: false, windowTitle: "Terminal Window 1", windowGroupId: "a", tabPosition: position)
    }
    let other = RemoteTerminalTabDescriptor(id: "b-1", title: "same-directory", detail: "Tab 1",
      isSelected: false, isBusy: false, windowTitle: "Terminal Window 2", windowGroupId: "b", tabPosition: 1)
    let groups = RemoteTerminalWindowGroup.make(first + [other])
    XCTAssertEqual(groups.map(\.id), ["a", "b"])
    XCTAssertEqual(groups[0].tabs.map(\.id), (1...20).map { "a-\($0)" })
    var expansion = RemoteTerminalWindowExpansion()
    expansion.reconcile(groups, selected: "a-12")
    XCTAssertTrue(expansion.isExpanded("a")); XCTAssertFalse(expansion.isExpanded("b"))
    expansion.toggle("a"); expansion.toggle("b")
    expansion.reconcile(groups, selected: "a-3")
    XCTAssertFalse(expansion.isExpanded("a")); XCTAssertTrue(expansion.isExpanded("b"))
  }
  func testLegacyCatalogRemainsAccessibleWithoutInventedWindowMembership() {
    let tab = RemoteTerminalTabDescriptor(id: "old", title: "Tab", detail: "Tab", isSelected: true, isBusy: false)
    let groups = RemoteTerminalWindowGroup.make([tab])
    XCTAssertEqual(groups.count, 1)
    XCTAssertEqual(groups[0].tabs, [tab])
  }
}
