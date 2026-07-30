import Foundation
import IOKit

enum MacConsoleSessionState {
  static func isLocked() -> Bool {
    let root = IORegistryGetRootEntry(kIOMainPortDefault)
    guard root != 0 else {
      return false
    }
    defer {
      IOObjectRelease(root)
    }

    let value = IORegistryEntryCreateCFProperty(
      root,
      "IOConsoleLocked" as CFString,
      kCFAllocatorDefault,
      0
    )?.takeRetainedValue()
    return lockedValue(value)
  }

  static func lockedValue(_ value: Any?) -> Bool {
    if let value = value as? Bool {
      return value
    }
    return (value as? NSNumber)?.boolValue ?? false
  }
}
