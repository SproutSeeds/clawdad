import XCTest
@testable import ClawDadMobile

final class VoiceSettingsDraftTests: XCTestCase {
  private let alba = MobileVoice(id: "alba", name: "Alba", language: "English", gender: "unspecified")
  private let anna = MobileVoice(id: "anna", name: "Anna", language: "English", gender: "unspecified")
  private let jasper = MobileVoice(id: "Jasper", name: "Jasper", language: "English", gender: "male")
  private let bella = MobileVoice(id: "Bella", name: "Bella", language: "English", gender: "female")

  private func settings(voice: String = "alba") -> MobileVoiceSettings {
    MobileVoiceSettings(models: [
      MobileVoiceModel(id: "pocket", name: "Pocket", modelId: "pocket-3.1", defaultVoice: "alba",
        supportsSpeed: false, installed: true, enabled: true, sizeLabel: "", voices: [alba, anna]),
      MobileVoiceModel(id: "kitten", name: "Kitten", modelId: "kitten-0.8", defaultVoice: "Bella",
        supportsSpeed: true, installed: true, enabled: true, sizeLabel: "", voices: [bella, jasper]),
    ], selection: MobileVoiceSelection(engine: "pocket", modelId: "pocket-3.1", voice: voice, speed: 1),
      voicesByModel: ["kitten": MobileVoiceSelection(engine: "kitten", modelId: "kitten-0.8", voice: "Jasper", speed: 1.2)],
      previewText: "Compare voices.")
  }

  func testFirstCatalogInitializesTheSavedChoice() {
    var draft = MobileVoiceSettingsDraft()
    XCTAssertFalse(draft.initialized)
    draft.receive(settings(voice: "anna"))
    XCTAssertEqual(draft.selection.voice, "anna")
    XCTAssertTrue(draft.initialized)
  }

  func testRefreshAndSaveReplyPreserveTheVoiceBeingBrowsedAndFilters() {
    var draft = MobileVoiceSettingsDraft(settings: settings())
    draft.selectModel("kitten")
    draft.language = "English"
    draft.gender = "male"
    draft.selection.speed = 1.35
    let expected = draft
    for _ in 0..<10 { draft.receive(settings(voice: "anna")) }
    XCTAssertEqual(draft.selection, expected.selection)
    XCTAssertEqual(draft.language, expected.language)
    XCTAssertEqual(draft.gender, expected.gender)
    XCTAssertEqual(draft.visibleVoices().map(\.id), ["Jasper"])
  }

  func testExplicitModelChangeUsesThatModelsSavedChoiceAndResetsFilters() {
    var draft = MobileVoiceSettingsDraft(settings: settings())
    draft.gender = "female"
    draft.selectModel("kitten")
    XCTAssertEqual(draft.selection.voice, "Jasper")
    XCTAssertEqual(draft.selection.speed, 1.2)
    XCTAssertEqual(draft.gender, "All")
    draft.selectModel("pocket")
    XCTAssertEqual(draft.selection.voice, "alba")
    XCTAssertEqual(draft.selection.speed, 1)
  }

  func testExplicitFilterChangeChoosesAnAvailableVoice() {
    var draft = MobileVoiceSettingsDraft(settings: settings())
    draft.selectModel("kitten")
    draft.gender = "female"
    draft.chooseVisibleVoice()
    XCTAssertEqual(draft.selection.voice, "Bella")
  }

  func testANewSettingsVisitUsesTheLatestSavedPreference() {
    let previous = MobileVoiceSettingsDraft(settings: settings())
    let reopened = MobileVoiceSettingsDraft(settings: settings(voice: "anna"))
    XCTAssertEqual(previous.selection.voice, "alba")
    XCTAssertEqual(reopened.selection.voice, "anna")
  }

  func testModelSwitchReadsTheLatestSavedChoiceWithoutReplacingTheActiveDraft() {
    let original = settings()
    var draft = MobileVoiceSettingsDraft(settings: original)
    let changed = MobileVoiceSettings(models: original.models, selection: original.selection,
      voicesByModel: ["kitten": MobileVoiceSelection(engine: "kitten", modelId: "kitten-0.8", voice: "Bella", speed: 0.85)],
      previewText: original.previewText)
    draft.selection.voice = "anna"
    draft.receive(changed)
    XCTAssertEqual(draft.selection.voice, "anna")
    draft.selectModel("kitten")
    XCTAssertEqual(draft.selection.voice, "Bella")
    XCTAssertEqual(draft.selection.speed, 0.85)
  }
}
