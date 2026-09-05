#if os(iOS)
import SwiftUI
import QuickLook

struct FilesLibraryView: View {
  @ObservedObject var controller: MobileFilesController
  @EnvironmentObject private var session: CloudSession
  @Environment(\.scenePhase) private var scenePhase
  var onClose: () -> Void
  @State private var search = ""
  @State private var archived = false
  @State private var onlyDownloads = false
  @State private var project = ""
  @State private var format = ""

  private var visibleItems: [MobileLibraryItem] {
    controller.items.filter { item in
      item.archived == archived && (project.isEmpty || item.project == (project == "__personal__" ? "" : project)) &&
        (format.isEmpty || item.versions.contains { $0.format == format }) &&
        (!onlyDownloads || item.versions.contains { controller.downloadedURL($0) != nil }) &&
        (search.isEmpty || ([item.title, item.project] + item.versions.map(\.fileName)).joined(separator: " ").localizedCaseInsensitiveContains(search))
    }.sorted { left, right in left.pinned != right.pinned ? left.pinned : left.updatedAt > right.updatedAt }
  }

  var body: some View {
    NavigationStack {
      List {
        Section {
          Text(controller.status).font(.footnote).foregroundStyle(.secondary)
          if !controller.error.isEmpty { Text(controller.error).font(.footnote).foregroundStyle(ClawDadTheme.peach) }
          if controller.connecting {
            HStack { ProgressView(); Text("Connecting to \(controller.computerName)…") }
          } else if !controller.connected {
            Button("Reconnect to Mac", systemImage: "arrow.clockwise") { controller.connect() }
          }
          Toggle("Downloaded on this iPhone", isOn: $onlyDownloads)
          HStack {
            Menu("Project", systemImage: "folder") {
              Button("All projects") { project = "" }
              ForEach(controller.projects, id: \.self) { value in
                Button(value.isEmpty ? "Personal" : URL(fileURLWithPath: value).lastPathComponent) { project = value.isEmpty ? "__personal__" : value }
              }
            }
            Spacer()
            Menu("Type", systemImage: "doc") {
              Button("All types") { format = "" }
              ForEach(controller.formats, id: \.self) { value in
                Button(value.isEmpty ? "Other" : value.uppercased()) { format = value }
              }
            }
            Spacer()
            Toggle("Archive", isOn: $archived).toggleStyle(.button)
          }
          if !project.isEmpty || !format.isEmpty {
            Button("Clear project and type filters") { project = ""; format = "" }
          }
        }
        Section("Documents") {
          if visibleItems.isEmpty {
            ContentUnavailableView("No files here yet", systemImage: "folder", description: Text("Add a finished document in ClawDad on your Mac, or ask your agent to save its deliverable to ClawDad Files."))
          }
          ForEach(visibleItems) { item in
            NavigationLink {
              MobileFileDetail(item: item, controller: controller)
            } label: {
              HStack(spacing: 12) {
                Image(systemName: item.pinned ? "pin.fill" : "doc.text").foregroundStyle(ClawDadTheme.gold)
                VStack(alignment: .leading, spacing: 4) {
                  Text(item.title).font(.headline)
                  Text("\(item.projectName) • \(item.latest?.format.uppercased() ?? "File") • \(item.versions.count) version\(item.versions.count == 1 ? "" : "s")")
                    .font(.caption).foregroundStyle(.secondary)
                }
                if item.versions.contains(where: { controller.downloadedURL($0) != nil }) {
                  Image(systemName: "checkmark.circle.fill").foregroundStyle(.green).accessibilityLabel("Available offline")
                }
              }
            }
          }
          if controller.nextCursor != nil, controller.connected {
            Button("Load more") { refresh(more: true) }.disabled(controller.busy)
          }
        }
      }
      .scrollContentBackground(.hidden)
      .background(ClawDadTheme.background)
      .navigationTitle("Files")
      .navigationBarTitleDisplayMode(.inline)
      .searchable(text: $search, prompt: "Find a document")
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Back", systemImage: "chevron.left") { controller.close(); onClose() }
            .keyboardShortcut(.cancelAction)
        }
        ToolbarItem(placement: .primaryAction) {
          Button("Refresh", systemImage: "arrow.clockwise") { refresh() }
            .disabled(controller.busy || controller.connecting)
        }
      }
      .task(id: "\(search)/\(archived)/\(project)/\(format)") {
        try? await Task.sleep(nanoseconds: 350_000_000)
        guard !Task.isCancelled else { return }
        refresh()
      }
      .onChange(of: scenePhase) { _, phase in if phase == .background { controller.cancelDownload() } }
    }
    .tint(ClawDadTheme.gold)
    .preferredColorScheme(.dark)
    .task { controller.open(to: session) }
    .onDisappear { controller.close() }
  }

  private func refresh(more: Bool = false) {
    controller.refresh(query: search, archived: archived, more: more, project: project, format: format)
  }
}

private struct MobileFileDetail: View {
  let item: MobileLibraryItem
  @ObservedObject var controller: MobileFilesController
  @State private var previewURL: URL?
  @Environment(\.dismiss) private var dismiss
  private var current: MobileLibraryItem { controller.items.first { $0.id == item.id } ?? item }
  private var latestFormats: [MobileLibraryVersion] {
    var seen = Set<String>()
    return current.versions.reversed().filter { seen.insert($0.format).inserted }
  }

  var body: some View {
    List {
      Section {
        Text(current.title).font(.title2.bold())
        Text(current.projectName).foregroundStyle(.secondary)
        Text(controller.status).font(.footnote).foregroundStyle(.secondary)
        if !controller.error.isEmpty { Text(controller.error).font(.footnote).foregroundStyle(ClawDadTheme.peach) }
      }
      Section("Latest files") { ForEach(latestFormats) { version in versionRow(version) } }
      if current.versions.count > latestFormats.count {
        Section {
          DisclosureGroup("Previous versions") {
            ForEach(current.versions.reversed().filter { version in !latestFormats.contains(where: { $0.id == version.id }) }) { version in versionRow(version) }
          }
        }
      }
      Section {
        Button(current.pinned ? "Unpin document" : "Pin document", systemImage: current.pinned ? "pin.slash" : "pin") {
          controller.update(current, pinned: !current.pinned)
        }.disabled(!controller.connected || controller.busy)
        Button(current.archived ? "Restore from archive" : "Archive document", systemImage: "archivebox") {
          controller.update(current, archived: !current.archived); dismiss()
        }.disabled(!controller.connected || controller.busy)
        Text("The Mac keeps the original library copy. Removing a download only frees space on this iPhone.")
          .font(.footnote).foregroundStyle(.secondary)
      }
    }
    .navigationTitle("Document")
    .scrollContentBackground(.hidden)
    .background(ClawDadTheme.background)
    .quickLookPreview($previewURL)
    .navigationBarBackButtonHidden()
    .toolbar {
      ToolbarItem(placement: .cancellationAction) {
        Button("Back", systemImage: "chevron.left") { dismiss() }.keyboardShortcut(.cancelAction)
      }
    }
  }

  @ViewBuilder private func versionRow(_ version: MobileLibraryVersion) -> some View {
    VStack(alignment: .leading, spacing: 10) {
      Text(version.fileName).font(.headline)
      Text("\(ByteCountFormatter.string(fromByteCount: Int64(version.size), countStyle: .file)) • \(String(version.createdAt.prefix(10)))")
        .font(.caption).foregroundStyle(.secondary)
      if let url = controller.downloadedURL(version) {
        Button("Open preview", systemImage: "doc.text.magnifyingglass") { previewURL = url }
        ShareLink(item: url) { Label("Save to Files or share", systemImage: "square.and.arrow.up") }
        Button("Remove iPhone download", systemImage: "trash", role: .destructive) { controller.removeDownload(version) }
          .font(.footnote)
      } else if controller.downloadingVersionId == version.id {
        ProgressView(value: controller.downloadProgress)
        Button("Pause download", systemImage: "pause") { controller.cancelDownload() }
      } else {
        Button(controller.hasPartialDownload(version) ? "Resume download" : "Download to iPhone", systemImage: "arrow.down.circle") {
          controller.download(current, version: version)
        }.disabled(controller.busy || controller.connecting)
      }
    }
    .padding(.vertical, 6)
  }
}
#endif
