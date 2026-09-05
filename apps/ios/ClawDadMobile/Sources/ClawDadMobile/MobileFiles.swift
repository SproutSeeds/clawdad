import Foundation
import SwiftUI
import CryptoKit
import ClawDadFileTransport
import ClawDadRemoteAssistProtocol

struct MobileLibraryVersion: Codable, Identifiable, Equatable, Sendable {
  let id: String
  let fileName: String
  let format: String
  let mimeType: String
  let size: Int
  let sha256: String
  let createdAt: String
  func validate() throws {
    guard UUID(uuidString: id) != nil, !fileName.isEmpty, fileName.utf8.count <= 1024,
          URL(fileURLWithPath: fileName).lastPathComponent == fileName,
          ![".", ".."].contains(fileName), size >= 0, size <= 100 * 1024 * 1024,
          sha256.range(of: "^[0-9a-f]{64}$", options: .regularExpression) != nil else { throw RemoteFileError.invalidMessage }
  }
}

struct MobileLibraryItem: Codable, Identifiable, Equatable, Sendable {
  let id: String
  let title: String
  let project: String
  let thread: String
  let pinned: Bool
  let archived: Bool
  let createdAt: String
  let updatedAt: String
  let versions: [MobileLibraryVersion]
  var latest: MobileLibraryVersion? { versions.last }
  var projectName: String { project.isEmpty ? "Personal" : URL(fileURLWithPath: project).lastPathComponent }
}

struct MobileLibraryPage: Decodable {
  let revision: Int
  let items: [MobileLibraryItem]
  let nextCursor: Int?
  let total: Int
  let projects: [String]?
  let formats: [String]?
}

struct MobileLibraryChunk: Decodable {
  let id: String
  let versionId: String
  let offset: Int
  let total: Int
  let sha256: String
  let nextOffset: Int
  let eof: Bool
  let dataBase64: String
}

/// Metadata and retained downloads belong to this phone and this pairing.
/// All paths are derived from validated IDs; removing a download never touches
/// the Mac library or the user's exports in the iOS Files app.
struct MobileFileCache: Sendable {
  let root: URL
  init(scope: String, base: URL? = nil) throws {
    let directory = base ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("ClawDadFiles", isDirectory: true)
    let key = SHA256.hash(data: Data(scope.utf8)).map { String(format: "%02x", $0) }.joined()
    root = directory.appendingPathComponent(key, isDirectory: true)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    var localRoot = root
    var values = URLResourceValues(); values.isExcludedFromBackup = true
    try localRoot.setResourceValues(values)
  }
  func items() -> [MobileLibraryItem] {
    guard let data = try? Data(contentsOf: root.appendingPathComponent("catalog.json")), data.count <= 16 * 1024 * 1024 else { return [] }
    return (try? JSONDecoder().decode([MobileLibraryItem].self, from: data)) ?? []
  }
  func save(_ items: [MobileLibraryItem]) throws {
    let data = try JSONEncoder().encode(items)
    guard data.count <= 16 * 1024 * 1024 else { throw RemoteFileError.tooLarge }
    try data.write(to: root.appendingPathComponent("catalog.json"), options: .atomic)
  }
  func url(_ version: MobileLibraryVersion, partial: Bool = false) throws -> URL {
    try version.validate()
    let directory = root.appendingPathComponent(version.id, isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    return directory.appendingPathComponent(partial ? ".download.partial" : version.fileName)
  }
  func downloaded(_ version: MobileLibraryVersion) -> URL? {
    guard let url = try? url(version), let info = try? url.resourceValues(forKeys: [.fileSizeKey]), info.fileSize == version.size else { return nil }
    return url
  }
  func partialSize(_ version: MobileLibraryVersion) -> Int {
    guard let url = try? url(version, partial: true) else { return 0 }
    return (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
  }
  func removeDownload(_ version: MobileLibraryVersion) throws {
    for partial in [false, true] {
      let path = try url(version, partial: partial)
      if FileManager.default.fileExists(atPath: path.path) { try FileManager.default.removeItem(at: path) }
    }
  }
  func finish(_ version: MobileLibraryVersion) throws -> URL {
    let partial = try url(version, partial: true)
    let handle = try FileHandle(forReadingFrom: partial)
    defer { try? handle.close() }
    var hash = SHA256(), count = 0
    while let data = try handle.read(upToCount: 64 * 1024), !data.isEmpty { hash.update(data: data); count += data.count }
    let digest = hash.finalize().map { String(format: "%02x", $0) }.joined()
    guard count == version.size, digest == version.sha256 else {
      try FileManager.default.removeItem(at: partial)
      throw NSError(domain: "ClawDad.Files", code: 1, userInfo: [NSLocalizedDescriptionKey: "The download did not match the Mac file. Download it again."])
    }
    let final = try url(version)
    if FileManager.default.fileExists(atPath: final.path) { try FileManager.default.removeItem(at: final) }
    try FileManager.default.moveItem(at: partial, to: final)
    return final
  }
}

@MainActor
final class MobileFilesController: ObservableObject {
  @Published private(set) var items: [MobileLibraryItem] = []
  @Published private(set) var status = "Files live on your Mac. Download a copy to keep it on this iPhone."
  @Published private(set) var error = ""
  @Published private(set) var connected = false
  @Published private(set) var connecting = false
  @Published private(set) var busy = false
  @Published private(set) var downloadingVersionId = ""
  @Published private(set) var downloadProgress: Double = 0
  @Published private(set) var nextCursor: Int?
  @Published private(set) var refreshToken = 0
  @Published private(set) var projects: [String] = []
  @Published private(set) var formats: [String] = []
  private weak var session: CloudSession?
  private var peer: PairedFilePeer?
  private var scope = ""
  private var sessionId = ""
  private var receivedOffer = false
  private var cache: MobileFileCache?
  private var connectTimeout: Task<Void, Never>?
  private var work: Task<Void, Never>?
  private var pending: (id: String, continuation: CheckedContinuation<Data, Error>)?
  private var requestTimeout: Task<Void, Never>?
  private var query = ""
  private var archived = false
  private var project = ""
  private var format = ""
  private var operationID = UUID()
  private var needsRefresh = false
  private var pageRevision: Int?
  private var desiredDownload: (MobileLibraryItem, MobileLibraryVersion)?

  var computerName: String { session?.activeComputerName ?? "Mac" }

  func open(to session: CloudSession) {
    let scope = "\(session.accountId)/\(session.workspaceId)/\(session.hostId)"
    close()
    if self.scope != scope {
      self.scope = scope
      self.cache = try? MobileFileCache(scope: scope)
    }
    items = cache?.items() ?? []
    projects = Array(Set(items.map(\.project))).sorted()
    formats = Array(Set(items.flatMap { $0.versions.map(\.format) })).sorted()
    query = ""; archived = false; project = ""; format = ""; nextCursor = nil; pageRevision = nil; error = ""
    self.session = session
    session.setFilesEnvelopeHandler { [weak self] envelope in self?.handle(envelope) }
    connect()
  }

  func connect() {
    guard !connected, !connecting, let session else { return }
    guard session.ready else {
      status = "\(computerName) is offline. Downloaded copies are available on this iPhone."
      session.connectIfPaired(); return
    }
    guard session.activeComputer?.capabilities.contains("files.local") == true else {
      error = "Update ClawDad on \(computerName) to use the local Files library. Downloaded copies still open here."
      return
    }
    guard session.remoteAssistIdentityReady else { error = "Pair this iPhone again to access Files."; return }
    connecting = true; error = ""; status = "Connecting directly to \(computerName)…"
    sessionId = UUID().uuidString.lowercased(); receivedOffer = false
    let id = sessionId
    let peer = PairedFilePeer(); self.peer = peer
    peer.onCandidate = { [weak self] sdp, mid, index in
      guard let self, self.sessionId == id else { return }
      Task { _ = try? await session.sendRemoteAssistEnvelope(type: "remote.assist.ice", body: ["sessionId": .string(id), "candidate": .object(["candidate": .string(sdp), "sdpMid": mid.map(JSONValue.string) ?? .null, "sdpMLineIndex": .number(Double(index))])]) }
    }
    peer.onOpen = { [weak self] in
      guard let self, self.sessionId == id else { return }
      self.connectTimeout?.cancel(); self.connectTimeout = nil
      self.connected = true; self.connecting = false
      self.status = "Connected directly to \(self.computerName)"
      if let desired = self.desiredDownload {
        self.desiredDownload = nil
        self.download(desired.0, version: desired.1)
      } else { self.refresh(query: self.query, archived: self.archived, project: self.project, format: self.format) }
    }
    peer.onMessage = { [weak self] data in self?.receive(data) }
    peer.onFailure = { [weak self] error in
      guard let self, self.sessionId == id else { return }
      self.connectionFailed(error.localizedDescription)
    }
    Task {
      do { _ = try await session.sendRemoteAssistEnvelope(type: "remote.assist.request", body: ["sessionId": .string(id), "purpose": .string("files"), "transport": .string("webrtc"), "control": .bool(false)]) }
      catch { if sessionId == id { connectionFailed(error.localizedDescription) } }
    }
    connectTimeout = Task { @MainActor [weak self] in
      try? await Task.sleep(nanoseconds: 25_000_000_000)
      guard !Task.isCancelled, let self, self.sessionId == id, !self.connected else { return }
      self.connectionFailed("This network could not establish a direct file connection. Try the same Wi-Fi or your private network. Downloaded copies remain available.")
    }
  }

  private func handle(_ envelope: CloudEnvelope) {
    guard !sessionId.isEmpty, envelope.body["sessionId"]?.stringValue == sessionId, let peer else { return }
    let id = sessionId
    switch envelope.type {
    case "remote.assist.offer":
      guard !receivedOffer, envelope.body["purpose"]?.stringValue == "files", let sdp = envelope.body["sdp"]?.stringValue else { return }
      receivedOffer = true
      Task {
        do {
          let answer = try await peer.acceptOffer(sdp)
          guard sessionId == id else { return }
          _ = try await session?.sendRemoteAssistEnvelope(type: "remote.assist.answer", body: ["sessionId": .string(id), "sdp": .string(answer)])
        } catch { if sessionId == id { connectionFailed(error.localizedDescription) } }
      }
    case "remote.assist.ice":
      guard case .object(let value) = envelope.body["candidate"], let sdp = value["candidate"]?.stringValue,
            let index = value["sdpMLineIndex"]?.numberValue, index >= 0, index < 128 else { return }
      Task { await peer.addCandidate(sdp: sdp, mid: value["sdpMid"]?.stringValue, index: Int32(index)) }
    case "remote.assist.stop", "remote.assist.error":
      connectionFailed(envelope.body["error"]?.stringValue ?? envelope.body["reason"]?.stringValue ?? "The file connection ended.")
    default: break
    }
  }

  private func request(_ command: RemoteFileRequest) async throws -> Data {
    try command.validate()
    guard pending == nil, connected, let peer else { throw RemoteFileError.disconnected }
    return try await withTaskCancellationHandler {
      try await withCheckedThrowingContinuation { continuation in
        pending = (command.requestId, continuation)
        requestTimeout = Task { @MainActor [weak self] in
          try? await Task.sleep(nanoseconds: 20_000_000_000)
          guard !Task.isCancelled, let self, self.pending?.id == command.requestId else { return }
          self.finishRequest(.failure(RemoteFileError.timedOut))
        }
        Task {
          do { try await peer.send(JSONEncoder().encode(command)) }
          catch { if pending?.id == command.requestId { finishRequest(.failure(error)) } }
        }
      }
    } onCancel: {
      Task { @MainActor [weak self] in
        if self?.pending?.id == command.requestId { self?.finishRequest(.failure(CancellationError())) }
      }
    }
  }

  private func receive(_ data: Data) {
    guard let response = try? JSONDecoder().decode(RemoteFileResponse.self, from: data), response.requestId == pending?.id else { return }
    if let error = response.error { finishRequest(.failure(NSError(domain: "ClawDad.Files", code: 1, userInfo: [NSLocalizedDescriptionKey: error]))) }
    else if let payload = response.payload { finishRequest(.success(payload)) }
    else { finishRequest(.failure(RemoteFileError.invalidMessage)) }
  }
  private func finishRequest(_ result: Result<Data, Error>) {
    requestTimeout?.cancel(); requestTimeout = nil
    let completion = pending?.continuation; pending = nil
    completion?.resume(with: result)
  }

  func refresh(query: String = "", archived: Bool = false, more: Bool = false, project: String = "", format: String = "") {
    self.query = query; self.archived = archived; self.project = project; self.format = format
    guard !busy else { if !more { needsRefresh = true }; return }
    guard connected else { items = cache?.items() ?? items; connect(); return }
    busy = true; error = ""
    let operation = UUID(); operationID = operation
    let cursor = more ? nextCursor ?? 0 : 0
    work = Task { @MainActor [weak self] in
      guard let self else { return }
      defer { self.finishWork(operation) }
      do {
        let data = try await request(RemoteFileRequest(action: .list, cursor: cursor, query: query, archived: archived, project: project, format: format))
        try Task.checkCancellation()
        let page = try JSONDecoder().decode(MobileLibraryPage.self, from: data)
        guard page.items.count <= 10 else { throw RemoteFileError.invalidMessage }
        for item in page.items {
          guard UUID(uuidString: item.id) != nil, item.versions.count <= 200 else { throw RemoteFileError.invalidMessage }
          try item.versions.forEach { try $0.validate() }
        }
        if more, let pageRevision, pageRevision != page.revision {
          error = "Files changed on the Mac. Refresh to load the current list."; nextCursor = nil; return
        }
        pageRevision = page.revision; nextCursor = page.nextCursor
        projects = page.projects ?? projects; formats = page.formats ?? formats
        var cached = Dictionary((cache?.items() ?? []).map { ($0.id, $0) }, uniquingKeysWith: { _, new in new })
        for item in page.items { cached[item.id] = item }
        let all = Array(cached.values).sorted { $0.updatedAt > $1.updatedAt }
        try cache?.save(all)
        items = more ? items.filter { prior in !page.items.contains(where: { $0.id == prior.id }) } + page.items : page.items
        status = "\(page.total) document\(page.total == 1 ? "" : "s") on \(computerName) • Direct connection"
      } catch is CancellationError { }
      catch { if operationID == operation { self.error = error.localizedDescription } }
    }
  }

  func downloadedURL(_ version: MobileLibraryVersion) -> URL? { cache?.downloaded(version) }
  func hasPartialDownload(_ version: MobileLibraryVersion) -> Bool { (cache?.partialSize(version) ?? 0) > 0 }
  func removeDownload(_ version: MobileLibraryVersion) {
    do { try cache?.removeDownload(version); refreshToken &+= 1 }
    catch { self.error = error.localizedDescription }
  }

  func download(_ item: MobileLibraryItem, version: MobileLibraryVersion) {
    guard !busy, let cache else { return }
    guard connected else { desiredDownload = (item, version); connect(); return }
    busy = true; downloadingVersionId = version.id; downloadProgress = 0; error = ""
    let operation = UUID(); operationID = operation
    work = Task { @MainActor [weak self] in
      guard let self else { return }
      defer { self.finishWork(operation) }
      do {
        try version.validate()
        let partial = try cache.url(version, partial: true)
        if !FileManager.default.fileExists(atPath: partial.path) { FileManager.default.createFile(atPath: partial.path, contents: Data()) }
        let handle = try FileHandle(forWritingTo: partial)
        defer { try? handle.close() }
        var offset = Int(try handle.seekToEnd())
        guard offset <= version.size else { try handle.truncate(atOffset: 0); throw RemoteFileError.invalidMessage }
        repeat {
          try Task.checkCancellation()
          let data = try await request(RemoteFileRequest(action: .chunk, id: item.id, versionId: version.id, offset: offset))
          try Task.checkCancellation()
          let chunk = try JSONDecoder().decode(MobileLibraryChunk.self, from: data)
          guard chunk.id == item.id, chunk.versionId == version.id, chunk.offset == offset,
                chunk.sha256 == version.sha256, chunk.total == version.size,
                let bytes = Data(base64Encoded: chunk.dataBase64), bytes.count <= 32 * 1024,
                chunk.nextOffset == offset + bytes.count, chunk.nextOffset <= version.size,
                chunk.eof == (chunk.nextOffset == version.size), !bytes.isEmpty || chunk.eof else { throw RemoteFileError.invalidMessage }
          try handle.write(contentsOf: bytes)
          offset = chunk.nextOffset
          downloadProgress = version.size == 0 ? 1 : Double(offset) / Double(version.size)
          if chunk.eof { break }
        } while offset < version.size
        try handle.synchronize()
        status = "Checking the downloaded file…"
        _ = try await Task.detached { try cache.finish(version) }.value
        try Task.checkCancellation()
        status = "\(version.fileName) is available offline on this iPhone."
      } catch is CancellationError { if operationID == operation { status = "Download paused. Tap Resume to continue." } }
      catch { if operationID == operation { self.error = error.localizedDescription } }
    }
  }

  func update(_ item: MobileLibraryItem, pinned: Bool? = nil, archived: Bool? = nil) {
    guard connected, !busy else { return }
    busy = true; error = ""
    let operation = UUID(); operationID = operation
    work = Task { @MainActor [weak self] in
      guard let self else { return }
      defer { self.finishWork(operation) }
      do {
        struct Update: Decodable { let item: MobileLibraryItem }
        let data = try await request(RemoteFileRequest(action: .update, id: item.id, pinned: pinned, archived: archived))
        try Task.checkCancellation()
        let updated = try JSONDecoder().decode(Update.self, from: data).item
        var saved = cache?.items() ?? []
        saved.removeAll { $0.id == updated.id }; saved.append(updated)
        try cache?.save(saved)
        needsRefresh = true
      } catch is CancellationError { }
      catch { if operationID == operation { self.error = error.localizedDescription } }
    }
  }

  private func finishWork(_ operation: UUID) {
    guard operationID == operation else { return }
    busy = false; downloadingVersionId = ""; work = nil; refreshToken &+= 1
    if needsRefresh {
      needsRefresh = false
      refresh(query: query, archived: archived, project: project, format: format)
    }
  }

  func cancelDownload() { work?.cancel() }
  private func connectionFailed(_ message: String) {
    close(); error = message
    items = cache?.items() ?? items
  }
  func close() {
    desiredDownload = nil
    operationID = UUID(); needsRefresh = false; busy = false; downloadingVersionId = ""
    work?.cancel(); connectTimeout?.cancel(); connectTimeout = nil
    work = nil
    finishRequest(.failure(RemoteFileError.disconnected))
    peer?.stop(); peer = nil
    connected = false; connecting = false
    let old = sessionId; sessionId = ""
    if !old.isEmpty, let session {
      Task { _ = try? await session.sendRemoteAssistEnvelope(type: "remote.assist.stop", body: ["sessionId": .string(old)]) }
    }
  }
}
