import XCTest
@testable import ClawDad

@MainActor final class MacAssistantExistingSubmissionTests: XCTestCase {
  func composer(_ text: String) -> MacAssistantSubmissionDraft { MacAssistantSubmissionDraft("› \(text)\n gpt-6-astra max", rows: 48)! }
  func testScrollbackIsExcludedAndRealComposerEditsAreDetected() {
    let a = MacAssistantSubmissionDraft("old output\n› [Pasted Content 4199 chars]\n gpt-6-astra max")
    let b = MacAssistantSubmissionDraft("put\n› [Pasted Content 4199 chars]\n gpt-6-astra max")
    XCTAssertEqual(a,b); XCTAssertNotEqual(a,composer("[Pasted Content 4200 chars]"))
    XCTAssertNotEqual(composer("word"),composer("Word"))
    XCTAssertNil(MacAssistantSubmissionDraft("[Image #1]\n› draft\n gpt-6-astra max"))
  }
  func testExpandedCollapsedAndUnicodeRequireAcceptedTurn() async throws {
    for text in ["Hello", "first line\nsecond line Ω", String(repeating: "Crayfish 🦞 e\u{301}\n", count: 200)] {
      let view = text.count > 500 ? composer("[Pasted Content \(text.unicodeScalars.count) chars]") : composer(text.replacingOccurrences(of: "\n", with: "\n  "))
      var keys=0, preparations=0
      let receipt = try await assistantSubmitExistingDraft(view, read: { view }, prepare: { preparations += 1 },
        dispatch: { keys += 1; return true }, accepted: { .init(turnId:"exact-turn",text:text,completed:false) }, wait: {})
      XCTAssertEqual(keys,1);XCTAssertEqual(preparations,1)
      XCTAssertEqual(receipt["turnAccepted"]?.bool,true);XCTAssertEqual(receipt["taskCompletionVerified"]?.bool,false)
      XCTAssertEqual(receipt["acceptedText"]?.string,text)
    }
  }
  func testEditsBeforeAndDuringPreparationPreventDispatch() async {
    for duringPrepare in [false,true] {
      let original=composer("original");var value=duringPrepare ? original:composer("changed"), keys=0
      do {
        _ = try await assistantSubmitExistingDraft(original,read:{value},prepare:{value=self.composer("changed")},
          dispatch:{keys += 1;return true},accepted:{nil},wait:{})
        XCTFail("Changed input must be preserved")
      } catch let failure as MacAssistantSubmissionFailure { XCTAssertEqual(failure.fields["keySent"]?.bool,false) }
      catch { XCTFail("Missing structured receipt") }
      XCTAssertEqual(keys,0)
    }
  }
  func testDispatchWithoutAcceptanceAndMismatchedTurnRemainUncertain() async {
    for observed: MacAssistantSubmissionLog.Accepted? in [nil,.init(turnId:"wrong",text:"different",completed:false)] {
      var keys=0;let draft=composer("Original")
      do {
        _ = try await assistantSubmitExistingDraft(draft,read:{draft},prepare:{},dispatch:{keys += 1;return true},accepted:{observed},wait:{})
        XCTFail("Dispatch is not acceptance")
      } catch let failure as MacAssistantSubmissionFailure {
        XCTAssertEqual(failure.fields["keySent"]?.bool,true);XCTAssertEqual(failure.fields["turnAccepted"]?.bool,false)
      } catch { XCTFail("Missing structured receipt") }
      XCTAssertEqual(keys,1)
    }
  }
  func testNewCompleteRolloutEventsOnly() throws {
    func event(_ payload:[String:String])->String { String(data:try! JSONSerialization.data(withJSONObject:["type":"event_msg","payload":payload]),encoding:.utf8)!+"\n" }
    let start=event(["type":"task_started","turn_id":"new"])
    let user=event(["type":"user_message","message":"Exact Ω"])
    XCTAssertNil(MacAssistantSubmissionLog.parse(Data(start.utf8)))
    XCTAssertNil(MacAssistantSubmissionLog.parse(Data(user.utf8)))
    XCTAssertNil(MacAssistantSubmissionLog.parse(Data((start+user.dropLast()).utf8)))
    XCTAssertEqual(MacAssistantSubmissionLog.parse(Data((start+user).utf8))?.text,"Exact Ω")
    XCTAssertNil(MacAssistantSubmissionLog.parse(Data((start+user+start).utf8)))
    XCTAssertTrue(MacAssistantSubmissionLog.parse(Data((start+user+event(["type":"task_complete","turn_id":"new"])).utf8))!.completed)
    func item(_ text:String)->String { String(data:try! JSONSerialization.data(withJSONObject:["type":"response_item","payload":["type":"message","role":"user","content":[["type":"input_text","text":text]]]]),encoding:.utf8)!+"\n" }
    XCTAssertEqual(MacAssistantSubmissionLog.parse(Data((start+item("Exact Ω")).utf8))?.text,"Exact Ω")
    XCTAssertEqual(MacAssistantSubmissionLog.parse(Data((start+user+item("Exact Ω")).utf8))?.text,"Exact Ω","Legacy mirror must not look like two submissions")
    XCTAssertEqual(MacAssistantSubmissionLog.parse(Data((start+item("Startup context")+item("Exact Ω")).utf8),expected:composer("Exact Ω"))?.text,"Exact Ω")
    XCTAssertNil(MacAssistantSubmissionLog.parse(Data((start+item("Wrong")).utf8),expected:composer("Exact Ω")))
  }
}
