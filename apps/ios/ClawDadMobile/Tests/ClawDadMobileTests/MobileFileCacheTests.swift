import XCTest
import CryptoKit
@testable import ClawDadMobile

final class MobileFileCacheTests: XCTestCase {
  func testOfflineDownloadChecksHashAndIsScopedToPairedComputer() throws {
    let base = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: base) }
    let cache = try MobileFileCache(scope: "account/workspace/mac", base: base)
    let other = try MobileFileCache(scope: "account/workspace/other", base: base)
    let data = Data("Exact deliverable. Café 🦞".utf8)
    let version = MobileLibraryVersion(id: UUID().uuidString, fileName: "Report.txt", format: "txt", mimeType: "text/plain", size: data.count, sha256: SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined(), createdAt: "2026-09-05")
    let partial = try cache.url(version, partial: true)
    try data.prefix(7).write(to: partial)
    XCTAssertEqual(cache.partialSize(version), 7)
    XCTAssertNil(cache.downloaded(version))
    let handle = try FileHandle(forWritingTo: partial)
    try handle.seekToEnd(); try handle.write(contentsOf: data.dropFirst(7)); try handle.close()
    let completed = try cache.finish(version)
    XCTAssertEqual(try Data(contentsOf: completed), data)
    XCTAssertNotNil(cache.downloaded(version))
    XCTAssertNil(other.downloaded(version))
    let exported = base.appendingPathComponent("Exported.txt")
    try FileManager.default.copyItem(at: completed, to: exported)
    try cache.removeDownload(version)
    XCTAssertNil(cache.downloaded(version))
    XCTAssertEqual(try Data(contentsOf: exported), data)
  }

  func testCorruptOrTraversingDownloadsNeverBecomeAvailableOffline() throws {
    let base = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: base) }
    let cache = try MobileFileCache(scope: "test", base: base)
    let version = MobileLibraryVersion(id: UUID().uuidString, fileName: "Report.txt", format: "txt", mimeType: "text/plain", size: 3, sha256: String(repeating: "0", count: 64), createdAt: "today")
    try Data("bad".utf8).write(to: cache.url(version, partial: true))
    XCTAssertThrowsError(try cache.finish(version))
    XCTAssertNil(cache.downloaded(version))
    let traversal = MobileLibraryVersion(id: UUID().uuidString, fileName: "../../private.txt", format: "txt", mimeType: "text/plain", size: 0, sha256: version.sha256, createdAt: "today")
    XCTAssertThrowsError(try cache.url(traversal))
  }
}
