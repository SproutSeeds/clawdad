import XCTest
@testable import ClawDadMobile

final class ProjectReadbackIdentityTests: XCTestCase {
  func testPlaybackIdentityKeepsProjectsThreadsParticipantsAndTextRevisionsSeparate() {
    let item = ClawDadAppStorePreviewFixture.make(scenario: .conversation).historyItems[0]
    func key(_ project: String, _ session: String, _ kind: MobileReadAloudKind, _ text: String) -> String {
      mobileProjectReadAloudKey(project: project, session: session, item: item, kind: kind, text: text)
    }
    let original = key("/one", "thread-one", .message, "Same text 🦞")
    XCTAssertEqual(original, key("/one", "thread-one", .message, "Same text 🦞"))
    XCTAssertEqual(Set([original,
      key("/two", "thread-one", .message, "Same text 🦞"),
      key("/one", "thread-two", .message, "Same text 🦞"),
      key("/one", "thread-one", .response, "Same text 🦞"),
      key("/one", "thread-one", .message, "Same text 🦞 plus final words")]).count, 5)
  }
}
