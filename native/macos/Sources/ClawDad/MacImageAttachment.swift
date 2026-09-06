import AppKit
import ClawDadRemoteAssistProtocol
import CryptoKit
import ImageIO

struct MacReceivedImage: Decodable, Sendable {
  let path: String
  let sha256: String
  let size: Int
}

struct MacPreparedImages {
  let urls: [URL]
  let firstImage: Data

  static func load(_ images: [MacReceivedImage]) throws -> Self {
    guard !images.isEmpty, images.count <= RemoteImageLimits.count,
          images.reduce(0, { $0 + max(0, min($1.size, RemoteImageLimits.fileBytes + 1)) }) <= RemoteImageLimits.batchBytes else { throw RemoteFileError.tooLarge }
    var first: Data?
    for image in images {
      guard image.path.hasPrefix("/"), image.size > 0, image.size <= RemoteImageLimits.fileBytes else { throw RemoteFileError.invalidMessage }
      let data = try Data(contentsOf: URL(fileURLWithPath: image.path), options: .mappedIfSafe)
      guard data.count == image.size, SHA256.hash(data: data).map({ String(format: "%02x", $0) }).joined() == image.sha256,
            let source = CGImageSourceCreateWithData(data as CFData, nil),
            let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
            let width = properties[kCGImagePropertyPixelWidth] as? Int,
            let height = properties[kCGImagePropertyPixelHeight] as? Int,
            width > 0, height > 0, width <= 40_000_000 / height,
            CGImageSourceCreateImageAtIndex(source, 0, nil) != nil else { throw RemoteFileError.invalidMessage }
      if first == nil { first = data }
    }
    return Self(urls: images.map { URL(fileURLWithPath: $0.path) }, firstImage: first!)
  }

  var terminalText: String {
    urls.indices.map { terminalText(at: $0) }.joined()
  }

  func terminalText(at index: Int) -> String { "'" + urls[index].path.replacingOccurrences(of: "'", with: "'\\''") + "' " }

  func copy(to pasteboard: NSPasteboard, from start: Int = 0, single: Bool = false) -> Bool {
    let selected = single ? [start] : Array(start..<urls.count)
    let text = selected.map { terminalText(at: $0) }.joined()
    let items = selected.map { index in
      let url = urls[index]
      let item = NSPasteboardItem()
      item.setString(url.absoluteString, forType: .fileURL)
      if index == start {
        item.setString(text, forType: .string)
        if urls.count == 1 { item.setData(firstImage, forType: url.pathExtension.lowercased() == "png" ? .png : NSPasteboard.PasteboardType("public.jpeg")) }
      }
      return item
    }
    pasteboard.clearContents()
    return pasteboard.writeObjects(items) && pasteboard.string(forType: .string) == text
  }
}

struct MacImageDeliveryReceipts {
  private var entries: [String: (RemoteImageAttachmentMessage, RemoteImageAttachmentMessage)] = [:]
  private var order: [String] = []
  func response(for request: RemoteImageAttachmentMessage) -> RemoteImageAttachmentMessage? {
    guard let entry = entries[request.requestId] else { return nil }
    return entry.0 == request ? entry.1 : request.result(error: "This attachment request changed. Choose the images again.")
  }
  mutating func remember(_ request: RemoteImageAttachmentMessage, response: RemoteImageAttachmentMessage) {
    guard entries[request.requestId] == nil else { return }
    entries[request.requestId] = (request, response); order.append(request.requestId)
    if order.count > 64 { entries.removeValue(forKey: order.removeFirst()) }
  }
}
