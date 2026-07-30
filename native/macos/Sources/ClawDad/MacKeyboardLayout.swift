import Carbon.HIToolbox
import CoreGraphics
import Foundation

struct MacKeyStroke: Equatable {
  let keyCode: CGKeyCode
  let flags: CGEventFlags
}

enum MacKeyboardLayout {
  private struct ModifierCandidate {
    let carbon: UInt32
    let eventFlags: CGEventFlags
  }

  private static let modifierCandidates = [
    ModifierCandidate(carbon: 0, eventFlags: []),
    ModifierCandidate(
      carbon: UInt32((shiftKey >> 8) & 0xff),
      eventFlags: .maskShift
    ),
    ModifierCandidate(
      carbon: UInt32((optionKey >> 8) & 0xff),
      eventFlags: .maskAlternate
    ),
    ModifierCandidate(
      carbon: UInt32(((shiftKey | optionKey) >> 8) & 0xff),
      eventFlags: [.maskShift, .maskAlternate]
    )
  ]

  static func keyStrokes(for text: String) -> [MacKeyStroke]? {
    guard !text.isEmpty,
          let characterMap = currentCharacterMap() else {
      return text.isEmpty ? [] : nil
    }

    var strokes: [MacKeyStroke] = []
    strokes.reserveCapacity(text.count)
    for character in text {
      if character == "\n" || character == "\r" {
        strokes.append(MacKeyStroke(keyCode: 36, flags: []))
        continue
      }
      if character == "\t" {
        strokes.append(MacKeyStroke(keyCode: 48, flags: []))
        continue
      }
      guard let stroke = characterMap[character] else {
        return nil
      }
      strokes.append(stroke)
    }
    return strokes
  }

  private static func currentCharacterMap() -> [Character: MacKeyStroke]? {
    guard let source = TISCopyCurrentKeyboardLayoutInputSource()?
      .takeRetainedValue(),
      let property = TISGetInputSourceProperty(
        source,
        kTISPropertyUnicodeKeyLayoutData
      ) else {
      return nil
    }

    let layoutData = unsafeBitCast(property, to: CFData.self)
    guard let bytes = CFDataGetBytePtr(layoutData) else {
      return nil
    }
    let layout = bytes.withMemoryRebound(
      to: UCKeyboardLayout.self,
      capacity: 1
    ) { $0 }

    var result: [Character: MacKeyStroke] = [:]
    for modifier in modifierCandidates {
      for keyCode in 0...127 {
        guard let character = translatedCharacter(
          layout: layout,
          keyCode: UInt16(keyCode),
          modifiers: modifier.carbon
        ),
        result[character] == nil else {
          continue
        }
        result[character] = MacKeyStroke(
          keyCode: CGKeyCode(keyCode),
          flags: modifier.eventFlags
        )
      }
    }
    return result
  }

  private static func translatedCharacter(
    layout: UnsafePointer<UCKeyboardLayout>,
    keyCode: UInt16,
    modifiers: UInt32
  ) -> Character? {
    var deadKeyState: UInt32 = 0
    var characters = [UniChar](repeating: 0, count: 8)
    var length = 0
    let status = characters.withUnsafeMutableBufferPointer { buffer in
      UCKeyTranslate(
        layout,
        keyCode,
        UInt16(kUCKeyActionDown),
        modifiers,
        UInt32(LMGetKbdType()),
        OptionBits(kUCKeyTranslateNoDeadKeysBit),
        &deadKeyState,
        buffer.count,
        &length,
        buffer.baseAddress
      )
    }
    guard status == noErr, length > 0 else {
      return nil
    }

    let value = String(
      utf16CodeUnits: characters,
      count: length
    )
    guard value.count == 1, let character = value.first else {
      return nil
    }
    return character
  }
}
