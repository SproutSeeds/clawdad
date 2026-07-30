import ApplicationServices

enum MacEditableTargetPolicy {
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
