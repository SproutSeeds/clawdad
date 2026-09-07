#if DEBUG && os(iOS)
import ClawDadRemoteAssistProtocol
import CryptoKit
import UIKit

/// Supplies wire payloads only. The production download, checksum, preview and
/// system export paths remain active in the UI tests.
struct MobileFilesPreview {
  let bytes: Data
  let item: MobileLibraryItem
  init() {
    let renderer = UIGraphicsPDFRenderer(bounds: CGRect(x: 0, y: 0, width: 612, height: 792))
    bytes = renderer.pdfData { context in
      context.beginPage()
      let title = "ClawDad Shared Files Test"
      title.draw(at: CGPoint(x: 48, y: 70), withAttributes: [.font: UIFont.boldSystemFont(ofSize: 26), .foregroundColor: UIColor.black])
      "Hello from your Mac.\nThis PDF contains real text.\nDownload, preview, and save this copy to Files."
        .draw(in: CGRect(x: 48, y: 130, width: 516, height: 300), withAttributes: [.font: UIFont.systemFont(ofSize: 18), .foregroundColor: UIColor.black])
    }
    let version = MobileLibraryVersion(id: UUID().uuidString, fileName: "ClawDad-Shared-Files-Test.pdf", format: "pdf", mimeType: "application/pdf", size: bytes.count,
      sha256: SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined(), createdAt: "2026-09-06T00:00:00Z")
    item = MobileLibraryItem(id: UUID().uuidString, title: "ClawDad Shared Files Test", project: "", thread: "", pinned: true, archived: false,
      createdAt: version.createdAt, updatedAt: version.createdAt, versions: [version])
  }
  func response(to request: RemoteFileRequest) throws -> Data {
    guard let version = item.latest else { throw RemoteFileError.invalidMessage }
    if request.action == .list {
      return try JSONEncoder().encode(MobileLibraryPage(revision: 1, items: [item], nextCursor: nil, total: 1, projects: [""], formats: ["pdf"]))
    }
    guard request.action == .chunk, request.id == item.id, request.versionId == version.id,
          let offset = request.offset, offset >= 0, offset <= bytes.count else { throw RemoteFileError.invalidMessage }
    let end = min(offset + 32 * 1024, bytes.count)
    return try JSONEncoder().encode(MobileLibraryChunk(id: item.id, versionId: version.id, offset: offset, total: bytes.count,
      sha256: version.sha256, nextOffset: end, eof: end == bytes.count, dataBase64: bytes.subdata(in: offset..<end).base64EncodedString()))
  }
}
#endif
