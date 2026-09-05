import ApplicationServices

enum MacEditableTargetPolicy {
  static func acceptsDictation(
    role: String, subrole: String?, explicitlyEditable: Bool?,
    selectedTextSettable: Bool, enabled: Bool?, focused: Bool?,
    bundleIdentifier: String? = nil
  ) -> Bool {
    // Terminal's text area includes read-only output but accepts pasted input.
    let terminalInput = bundleIdentifier == "com.apple.Terminal" && role == (kAXTextAreaRole as String)
    guard (explicitlyEditable != false || terminalInput), enabled != false, focused != false,
          subrole != (kAXSecureTextFieldSubrole as String) else { return false }
    return isEditable(role: role, subrole: subrole,
                      explicitlyEditable: explicitlyEditable,
                      selectedTextSettable: selectedTextSettable)
  }

  static func isEditable(
    role: String,
    subrole: String?,
    explicitlyEditable: Bool?,
    selectedTextSettable: Bool
  ) -> Bool {
    explicitlyEditable == true ||
      role == (kAXTextFieldRole as String) ||
      role == (kAXTextAreaRole as String) ||
      role == (kAXComboBoxRole as String) ||
      subrole == (kAXSearchFieldSubrole as String) ||
      subrole == (kAXSecureTextFieldSubrole as String) ||
      selectedTextSettable
  }

  static func requiresPhysicalKeystrokes(
    screenLocked: Bool,
    subrole: String?
  ) -> Bool {
    screenLocked || subrole == (kAXSecureTextFieldSubrole as String)
  }
}
