import AppKit
import ApplicationServices
import Foundation

// Read structural metadata only. Do not read AXValue from Terminal text areas.
func read(_ element: AXUIElement, _ name: String) -> Any? {
  AXUIElementSetMessagingTimeout(element, 0.2)
  var result: CFTypeRef?
  let error = AXUIElementCopyAttributeValue(element, name as CFString, &result)
  return error == .success ? result : nil
}
func describe(_ element: AXUIElement, depth: Int = 0) -> [String: Any] {
  let role = read(element, kAXRoleAttribute) as? String ?? ""
  var result: [String: Any] = ["role": role]
  if role == kAXTextAreaRole { return result }
  var names: CFArray?
  AXUIElementCopyAttributeNames(element, &names)
  result["attributes"] = names as? [String] ?? []
  for name in [kAXTitleAttribute, kAXDescriptionAttribute, kAXIdentifierAttribute, kAXSubroleAttribute, kAXHelpAttribute, kAXDocumentAttribute] {
    if let value = read(element, name) as? String { result[name] = value }
  }
  if role == kAXRadioButtonRole || role == kAXTabGroupRole {
    for name in [kAXWindowAttribute, kAXTopLevelUIElementAttribute, kAXContentsAttribute] {
      guard let value = read(element, name) else { continue }
      let links: [AXUIElement] = (value as? [AXUIElement]) ??
        (CFGetTypeID(value as CFTypeRef) == AXUIElementGetTypeID() ? [value as! AXUIElement] : [])
      result[name] = links.map { link in
        ["role": read(link, kAXRoleAttribute) as? String ?? "",
         "identifier": read(link, kAXIdentifierAttribute) as? String ?? "",
         "title": read(link, kAXTitleAttribute) as? String ?? ""]
      }
    }
  }
  if role == kAXRadioButtonRole {
    var raw: CFTypeRef?
    result["valueError"] = AXUIElementCopyAttributeValue(element, kAXValueAttribute as CFString, &raw).rawValue
    result["selected"] = raw.map { String(describing: $0) }
  }
  if role == kAXTabGroupRole {
    let tabs = read(element, kAXTabsAttribute) as? [AXUIElement] ?? []
    result["tabEnumeration"] = tabs.map { read($0, kAXTitleAttribute) as? String ?? "" }
    if let value = read(element, kAXValueAttribute) {
      result["groupValueType"] = String(describing: type(of: value))
      if CFGetTypeID(value as CFTypeRef) == AXUIElementGetTypeID() {
        result["groupSelectedIndex"] = tabs.firstIndex { CFEqual($0, value as CFTypeRef) }
      } else { result["groupValue"] = String(describing: value) }
    }
  }
  if let position = read(element, kAXPositionAttribute), CFGetTypeID(position as CFTypeRef) == AXValueGetTypeID() {
    var point = CGPoint.zero
    if AXValueGetValue(position as! AXValue, .cgPoint, &point) { result["position"] = [point.x, point.y] }
  }
  if let size = read(element, kAXSizeAttribute), CFGetTypeID(size as CFTypeRef) == AXValueGetTypeID() {
    var sizeValue = CGSize.zero
    if AXValueGetValue(size as! AXValue, .cgSize, &sizeValue) { result["size"] = [sizeValue.width, sizeValue.height] }
  }
  if depth < 8, let children = read(element, kAXChildrenAttribute) as? [AXUIElement] {
    result["children"] = children.prefix(128).map { describe($0, depth: depth + 1) }
  }
  return result
}
guard let app = NSRunningApplication.runningApplications(withBundleIdentifier: "com.apple.Terminal").first else { fatalError("Terminal is not running.") }
let application = AXUIElementCreateApplication(app.processIdentifier)
let windows = read(application, kAXWindowsAttribute) as? [AXUIElement] ?? []
let report: [String: Any] = ["trusted": AXIsProcessTrusted(), "windows": windows.map { describe($0) }]
let data = try JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys])
FileHandle.standardOutput.write(data)
