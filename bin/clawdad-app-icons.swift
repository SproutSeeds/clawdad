#!/usr/bin/env swift
import Foundation
import CoreGraphics
import ImageIO

// Repackage the approved mascot for system icons without redrawing its artwork.
let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
let catalog = root.appendingPathComponent("apps/ios/ClawDadMobile/Resources/Assets.xcassets")
let sourceURL = catalog.appendingPathComponent("ClawDadMascot.imageset/clawdad-mascot.png")
guard let source = CGImageSourceCreateWithURL(sourceURL as CFURL, nil),
      let artwork = CGImageSourceCreateImageAtIndex(source, 0, nil),
      let colorSpace = CGColorSpace(name: CGColorSpace.sRGB) else {
    fatalError("Cannot load the approved ClawDad mascot")
}

// Trim transparent padding, retaining every visible part of the mascot and claw.
let width = artwork.width, height = artwork.height
var pixels = [UInt8](repeating: 0, count: width * height * 4)
var left = width, right = 0, top = height, bottom = 0
pixels.withUnsafeMutableBytes { bytes in
    guard let context = CGContext(data: bytes.baseAddress, width: width, height: height,
        bitsPerComponent: 8, bytesPerRow: width * 4, space: colorSpace,
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else {
        fatalError("Cannot inspect the mascot bounds")
    }
    context.draw(artwork, in: CGRect(x: 0, y: 0, width: width, height: height))
    let rgba = bytes.bindMemory(to: UInt8.self)
    for y in 0..<height {
        for x in 0..<width where rgba[(y * width + x) * 4 + 3] > 0 {
            left = min(left, x); right = max(right, x)
            top = min(top, y); bottom = max(bottom, y)
        }
    }
}
guard left <= right, top <= bottom,
      let cropped = artwork.cropping(to: CGRect(x: left, y: top,
        width: right - left + 1, height: bottom - top + 1)) else {
    fatalError("The mascot has no visible artwork")
}

func png(size: Int) -> Data {
    // An opaque sRGB canvas is required for the App Store marketing icon.
    guard let context = CGContext(data: nil, width: size, height: size,
        bitsPerComponent: 8, bytesPerRow: size * 4, space: colorSpace,
        bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else {
        fatalError("Cannot create an icon canvas")
    }
    // Match the app's LaunchBackground color.
    context.setFillColor(red: 0.090, green: 0.000, blue: 0.012, alpha: 1)
    context.fill(CGRect(x: 0, y: 0, width: size, height: size))
    let scale = Double(size) * 0.92 / Double(max(cropped.width, cropped.height))
    let renderedWidth = Double(cropped.width) * scale
    let renderedHeight = Double(cropped.height) * scale
    context.interpolationQuality = .high
    context.draw(cropped, in: CGRect(x: (Double(size) - renderedWidth) / 2,
        y: (Double(size) - renderedHeight) / 2, width: renderedWidth, height: renderedHeight))
    guard let image = context.makeImage() else { fatalError("Cannot render an icon") }
    let output = NSMutableData()
    guard let destination = CGImageDestinationCreateWithData(output, "public.png" as CFString, 1, nil) else {
        fatalError("Cannot encode an icon")
    }
    CGImageDestinationAddImage(destination, image, nil)
    guard CGImageDestinationFinalize(destination) else { fatalError("Cannot finish an icon") }
    return output as Data
}

struct IconCatalog: Decodable {
    struct Entry: Decodable { let filename: String; let size: String; let scale: String }
    let images: [Entry]
}
let iconSet = catalog.appendingPathComponent("AppIcon.appiconset")
let entries = try JSONDecoder().decode(IconCatalog.self,
    from: Data(contentsOf: iconSet.appendingPathComponent("Contents.json"))).images
var outputs: [(URL, Int)] = try entries.map { entry in
    guard let points = Double(entry.size.split(separator: "x")[0]),
          let scale = Double(entry.scale.dropLast()) else { throw CocoaError(.fileReadCorruptFile) }
    return (iconSet.appendingPathComponent(entry.filename), Int(points * scale))
}
outputs += [1024, 512, 192].map { (root.appendingPathComponent("assets/clawdad-app-icon-\($0).png"), $0) }
outputs.append((root.appendingPathComponent("assets/clawdad-apple-touch-icon.png"), 180))
for (url, size) in outputs { try png(size: size).write(to: url, options: .atomic) }
print("Updated \(outputs.count) icon assets from the approved baby-in-a-claw mascot.")
