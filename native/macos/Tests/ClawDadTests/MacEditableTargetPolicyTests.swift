import XCTest
@testable import ClawDad

final class MacEditableTargetPolicyTests: XCTestCase {
  func testTextRolesAreEditable() {
    XCTAssertTrue(MacEditableTargetPolicy.isEditable(
      role: "AXTextField",
      subrole: nil,
      explicitlyEditable: nil,
      selectedTextSettable: false
    ))
    XCTAssertTrue(MacEditableTargetPolicy.isEditable(
      role: "AXTextArea",
      subrole: nil,
      explicitlyEditable: false,
      selectedTextSettable: false
    ))
  }

  func testWebAreaWithoutEditableSignalsIsRejected() {
    XCTAssertFalse(MacEditableTargetPolicy.isEditable(
      role: "AXWebArea",
      subrole: nil,
      explicitlyEditable: false,
      selectedTextSettable: false
    ))
  }

  func testCustomEditorCanUseAccessibilitySignals() {
    XCTAssertTrue(MacEditableTargetPolicy.isEditable(
      role: "AXGroup",
      subrole: nil,
      explicitlyEditable: true,
      selectedTextSettable: false
    ))
    XCTAssertTrue(MacEditableTargetPolicy.isEditable(
      role: "AXGroup",
      subrole: nil,
      explicitlyEditable: nil,
      selectedTextSettable: true
    ))
  }

  func testLockedAndSecureFieldsRequirePhysicalKeystrokes() {
    XCTAssertTrue(MacEditableTargetPolicy.requiresPhysicalKeystrokes(
      screenLocked: true,
      subrole: nil
    ))
    XCTAssertTrue(MacEditableTargetPolicy.requiresPhysicalKeystrokes(
      screenLocked: false,
      subrole: "AXSecureTextField"
    ))
    XCTAssertFalse(MacEditableTargetPolicy.requiresPhysicalKeystrokes(
      screenLocked: false,
      subrole: nil
    ))
  }
}
