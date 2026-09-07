import ClawDadRemoteAssistProtocol
import Foundation

struct RemoteTerminalCloseIntent: Identifiable, Equatable {
  let id = UUID()
  let tab: RemoteTerminalTabDescriptor
  let revision: Int
  let isLastTab: Bool
  var token: String?
  var nativePrompt: String?
  var nativeButton: String?

  var title: String { "Close \(tab.title)?" }
  var button: String { nativeButton ?? (isLastTab ? "Close Window" : "Close Tab") }
  var message: String {
    let location = "\(tab.windowTitle ?? "Terminal") · Tab \(tab.tabPosition ?? 1)"
    if let nativePrompt { return "\(location)\n\n\(nativePrompt)" }
    var text = location
    if tab.isBusy { text += "\n\nAn agent is working in this tab. Closing it can interrupt that request." }
    if isLastTab { text += "\n\nThis is the last tab, so its Terminal window will close." }
    return text
  }
}
