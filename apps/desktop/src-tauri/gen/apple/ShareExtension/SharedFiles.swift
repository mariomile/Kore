import Foundation
import ImageIO
import UniformTypeIdentifiers

/// Photos and PDFs shared to Kore: which attachments are files, and how each
/// one is copied out of its provider into the extension's own temporary
/// folder (a HEIC photo transcoded to JPEG on the way). Foundation and
/// ImageIO only, so `ShareExtensionTests` compiles it on macOS.

/// One shared file (a photo, a PDF), copied into the extension's own
/// temporary folder while its provider's callback still held it.
struct SharedFile: Equatable {
    /// The local copy.
    let url: URL
    /// Its name as shared, extension included: the attachment's name in the vault.
    let name: String

    /// The name without its extension, what a new note is called after.
    var title: String {
        (name as NSString).deletingPathExtension
    }

    var isImage: Bool {
        UTType(filenameExtension: url.pathExtension)?.conforms(to: .image) ?? false
    }

    var isPDF: Bool {
        UTType(filenameExtension: url.pathExtension)?.conforms(to: .pdf) ?? false
    }
}

enum SharedFiles {
    /// A photo or a PDF.
    static func isSharedFile(_ provider: NSItemProvider) -> Bool {
        provider.hasItemConformingToTypeIdentifier(UTType.image.identifier)
            || provider.hasItemConformingToTypeIdentifier(UTType.pdf.identifier)
    }

    /// A web address (a file URL is how some apps hand over a file, not a link).
    static func isWebUrl(_ provider: NSItemProvider) -> Bool {
        provider.hasItemConformingToTypeIdentifier(UTType.url.identifier)
            && !provider.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier)
    }

    /// Image formats every Markdown reader draws (Obsidian's Chromium has no
    /// HEIC), in the order a provider offering several is asked for them.
    private static let portableImageTypes: [UTType] = [.jpeg, .png, .gif, .webP]

    /// Longest edge of a HEIC photo transcoded to JPEG: sharp on any screen,
    /// and a decode the extension's memory budget can afford.
    private static let transcodeMaxPixels = 4096

    /// Copy every provider's file into one fresh temporary folder, keeping
    /// the providers' order; a provider that fails to load is skipped.
    static func extract(
        from providers: [NSItemProvider],
        completion: @escaping ([SharedFile]) -> Void
    ) {
        let folder = FileManager.default.temporaryDirectory
            .appendingPathComponent("kore-share-\(UUID().uuidString)", isDirectory: true)
        guard (try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)) != nil
        else {
            return completion([])
        }
        let group = DispatchGroup()
        let lock = NSLock()
        var loaded = [SharedFile?](repeating: nil, count: providers.count)
        for (index, provider) in providers.enumerated() {
            guard let type = loadType(of: provider) else {
                continue
            }
            group.enter()
            _ = provider.loadFileRepresentation(forTypeIdentifier: type.identifier) { url, _ in
                defer { group.leave() }
                // The file at `url` is deleted once this callback returns.
                guard let url else {
                    return
                }
                let file = copy(url, of: type, named: provider.suggestedName, index: index, into: folder)
                lock.lock()
                loaded[index] = file
                lock.unlock()
            }
        }
        group.notify(queue: .global(qos: .userInitiated)) {
            completion(loaded.compactMap { $0 })
        }
    }

    /// Remove the temporary copies `extract` made (`<folder>/<index>/<name>`),
    /// once they are spooled or the share is dropped.
    static func discard(_ files: [SharedFile]) {
        guard let folder = files.first?.url.deletingLastPathComponent().deletingLastPathComponent() else {
            return
        }
        try? FileManager.default.removeItem(at: folder)
    }

    /// What to ask a provider for: a PDF as itself, a photo in a format every
    /// reader draws when the provider offers one, else its own format.
    private static func loadType(of provider: NSItemProvider) -> UTType? {
        let registered = provider.registeredTypeIdentifiers.compactMap(UTType.init)
        if let pdf = registered.first(where: { $0.conforms(to: .pdf) }) {
            return pdf
        }
        for portable in portableImageTypes where registered.contains(where: { $0.conforms(to: portable) }) {
            return portable
        }
        return registered.first { $0.conforms(to: .image) }
    }

    /// Copy one loaded file into `folder` under its shared name, a HEIC
    /// photo transcoded to JPEG on the way. Nil when the copy fails.
    private static func copy(
        _ source: URL, of type: UTType, named suggested: String?, index: Int, into folder: URL
    ) -> SharedFile? {
        let transcode = type.conforms(to: .image) && !portableImageTypes.contains { type.conforms(to: $0) }
        let target = transcode ? UTType.jpeg : type
        let name = fileName(suggested: suggested, source: source, extension: target.preferredFilenameExtension)
        // One subfolder per file keeps two "image.jpg"s from colliding.
        let slot = folder.appendingPathComponent("\(index)", isDirectory: true)
        let destination = slot.appendingPathComponent(name)
        do {
            try FileManager.default.createDirectory(at: slot, withIntermediateDirectories: true)
            if transcode {
                guard transcodeToJpeg(source, to: destination) else {
                    return nil
                }
            } else {
                try FileManager.default.copyItem(at: source, to: destination)
            }
        } catch {
            return nil
        }
        return SharedFile(url: destination, name: name)
    }

    /// The shared name with the extension of what is actually saved: the
    /// provider's suggested name (which often has none), else the loaded
    /// file's own. An extension the name already carries is replaced only
    /// when it is a real file type ("Report v1.2" keeps its ".2").
    static func fileName(suggested: String?, source: URL, extension ext: String?) -> String {
        let trimmed = suggested?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let raw = (trimmed.isEmpty ? source.lastPathComponent : trimmed)
            .replacingOccurrences(of: "/", with: "-")
        let current = (raw as NSString).pathExtension
        let isFileType = !current.isEmpty && UTType(filenameExtension: current)?.isDeclared == true
        let stem = isFileType ? (raw as NSString).deletingPathExtension : raw
        let name = stem.isEmpty ? "Shared file" : stem
        guard let ext = ext ?? (isFileType ? current : nil) else {
            return name
        }
        return "\(name).\(ext)"
    }

    /// The image at `url`, upright, decoded straight down to `maxPixels` on
    /// its long edge (never the full-size bitmap): the sheet's thumbnails
    /// and the HEIC transcode both read photos this way.
    static func downsampled(_ url: URL, maxPixels: Int) -> CGImage? {
        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil) else {
            return nil
        }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: maxPixels,
        ]
        return CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary)
    }

    /// A HEIC/HEIF photo as a JPEG, upright, its long edge capped at
    /// `transcodeMaxPixels`.
    private static func transcodeToJpeg(_ source: URL, to destination: URL) -> Bool {
        guard
            let decoded = downsampled(source, maxPixels: transcodeMaxPixels),
            let output = CGImageDestinationCreateWithURL(
                destination as CFURL, UTType.jpeg.identifier as CFString, 1, nil)
        else {
            return false
        }
        CGImageDestinationAddImage(
            output, decoded, [kCGImageDestinationLossyCompressionQuality: 0.85] as CFDictionary)
        return CGImageDestinationFinalize(output)
    }
}
