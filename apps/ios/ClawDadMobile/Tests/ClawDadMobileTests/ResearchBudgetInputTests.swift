import XCTest
@testable import ClawDadMobile

final class ResearchBudgetInputTests: XCTestCase {
  func testAcceptsExactStoppingPercentagesIncludingZero() {
    for value in 0...100 { XCTAssertEqual(ResearchBudgetInput.threshold(String(value)), value) }
    XCTAssertEqual(ResearchBudgetInput.threshold(" 5\n"), 5)
  }
  func testRejectsIncompleteFractionalAndOutOfRangeInput() {
    for value in ["", " ", "-1", "101", "1.5", "+5", "5%", "1e1", "０", "NaN"] {
      XCTAssertNil(ResearchBudgetInput.threshold(value), value)
    }
  }
}
