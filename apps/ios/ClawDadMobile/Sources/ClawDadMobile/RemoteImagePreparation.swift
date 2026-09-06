import Foundation
import CryptoKit
import ImageIO
import UniformTypeIdentifiers
import ClawDadRemoteAssistProtocol

struct PreparedRemoteImage: Identifiable, Sendable {
  let upload: RemoteImageUpload
  let data: Data
  var id: String { upload.id }
}

enum RemoteImagePreparation {
  static func prepare(_ data: Data, fileName: String? = nil) throws -> PreparedRemoteImage {
    guard !data.isEmpty, data.count <= 80 * 1024 * 1024,
          let source = CGImageSourceCreateWithData(data as CFData, nil),
          let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
          let width = properties[kCGImagePropertyPixelWidth] as? Int,
          let height = properties[kCGImagePropertyPixelHeight] as? Int,
          width > 0, height > 0, width <= 40_000_000 / height else {
      throw failure("Choose a readable image up to 40 megapixels.")
    }
    let type = CGImageSourceGetType(source) as String?
    let png = type == UTType.png.identifier
    let jpeg = type == UTType.jpeg.identifier
    let orientation = properties[kCGImagePropertyOrientation] as? Int ?? 1
    let bytes: Data
    if (png || jpeg), orientation == 1, data.count <= RemoteImageLimits.fileBytes {
      bytes = data // Preserve full-resolution screenshots and their sharp text.
    } else {
      guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [
        kCGImageSourceCreateThumbnailFromImageAlways: true,
        kCGImageSourceCreateThumbnailWithTransform: true,
        kCGImageSourceThumbnailMaxPixelSize: max(width, height)
      ] as CFDictionary) else { throw failure("The photo could not be prepared.") }
      let output = NSMutableData()
      guard let destination = CGImageDestinationCreateWithData(output, (png ? UTType.png.identifier : UTType.jpeg.identifier) as CFString, 1, nil) else { throw failure("The photo could not be prepared.") }
      CGImageDestinationAddImage(destination, image, [kCGImageDestinationLossyCompressionQuality: 0.92] as CFDictionary)
      guard CGImageDestinationFinalize(destination) else { throw failure("The photo could not be prepared.") }
      bytes = output as Data
    }
    guard bytes.count <= RemoteImageLimits.fileBytes else { throw failure("This image exceeds 20 MB. Crop it or choose a smaller copy.") }
    let ext = png ? "png" : "jpg"
    let base = fileName.map { URL(fileURLWithPath: $0).deletingPathExtension().lastPathComponent } ?? "iPhone-image"
    let safe = base.unicodeScalars.filter { CharacterSet.alphanumerics.contains($0) || " -_".unicodeScalars.contains($0) }.map(String.init).joined()
    let name = String(safe.unicodeScalars.prefix(40)).trimmingCharacters(in: .whitespaces)
    let upload = RemoteImageUpload(fileName: "\(name.isEmpty ? "iPhone-image" : name).\(ext)", mimeType: png ? "image/png" : "image/jpeg", size: bytes.count,
      sha256: SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined())
    try upload.validate()
    return PreparedRemoteImage(upload: upload, data: bytes)
  }
  static func failure(_ text: String) -> NSError { NSError(domain: "ClawDad.Images", code: 1, userInfo: [NSLocalizedDescriptionKey: text]) }
}
