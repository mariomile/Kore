import SwiftUI
import UIKit

/// The share sheet's preview of shared photos and PDFs (`ShareView` shows it
/// in place of the link preview). Colors are `KoreColor`'s design tokens.

/// The shared files as they will land: photos as the images they are, a
/// PDF as the file chip the editor draws. Thumbnails are decoded small, off
/// the main thread, so a share of ten photos opens as fast as one.
struct FilesPreview: View {
    let files: [SharedFile]
    let leftOut: Int

    /// Photos past this show as a "+N" on the last tile.
    private static let maxTiles = 6

    var body: some View {
        let images = files.filter(\.isImage)
        let documents = files.filter { !$0.isImage }
        VStack(alignment: .leading, spacing: 8) {
            if images.count == 1, let image = images.first {
                Thumbnail(file: image, maxPixels: 1200)
                    .frame(maxWidth: .infinity)
                    .frame(height: 220)
                    .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            } else if !images.isEmpty {
                PhotoGrid(images: images, maxTiles: Self.maxTiles)
            }
            if !documents.isEmpty {
                VStack(spacing: 0) {
                    ForEach(documents, id: \.url) { FileRow(file: $0) }
                }
                .background(KoreColor.surface)
                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            }
            if leftOut > 0 {
                Text("Kore saves the first \(CaptureInbox.maxFiles) of \(CaptureInbox.maxFiles + leftOut).")
                    .font(.footnote)
                    .foregroundColor(KoreColor.muted)
                    .frame(maxWidth: .infinity)
                    .padding(.top, 4)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilityLabel(images: images.count, documents: documents.count))
    }

    private func accessibilityLabel(images: Int, documents: Int) -> String {
        var parts: [String] = []
        if images > 0 { parts.append(images == 1 ? "1 photo" : "\(images) photos") }
        if documents > 0 { parts.append(documents == 1 ? "1 file" : "\(documents) files") }
        return "Preview, " + parts.joined(separator: " and ")
    }
}

/// Square tiles, three to a row, the last one counting what does not fit.
private struct PhotoGrid: View {
    let images: [SharedFile]
    let maxTiles: Int

    var body: some View {
        let shown = Array(images.prefix(maxTiles))
        let hidden = images.count - shown.count
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 4), count: 3), spacing: 4) {
            ForEach(Array(shown.enumerated()), id: \.element.url) { index, image in
                Color.clear
                    .aspectRatio(1, contentMode: .fit)
                    .overlay(Thumbnail(file: image, maxPixels: 400))
                    .overlay {
                        if hidden > 0, index == shown.count - 1 {
                            ZStack {
                                Color.black.opacity(0.45)
                                Text("+\(hidden)")
                                    .font(.title3.weight(.semibold))
                                    .foregroundColor(.white)
                            }
                        }
                    }
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            }
        }
        .padding(4)
        .background(KoreColor.surface)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
}

/// A photo, decoded down to `maxPixels` on a background queue, filling its frame.
private struct Thumbnail: View {
    let file: SharedFile
    let maxPixels: Int
    @State private var image: UIImage?

    var body: some View {
        ZStack {
            KoreColor.active
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
                    .transition(.opacity)
            }
        }
        .clipped()
        .task(id: file.url) {
            let url = file.url
            let pixels = maxPixels
            let decoded = await Task.detached(priority: .userInitiated) {
                SharedFiles.downsampled(url, maxPixels: pixels)
            }.value
            withAnimation(.easeOut(duration: 0.15)) { image = decoded.map { UIImage(cgImage: $0) } }
        }
        .accessibilityHidden(true)
    }

}

/// A PDF (or any other file) as the editor's file chip: its icon, its name,
/// its kind and size.
private struct FileRow: View {
    let file: SharedFile

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: file.isPDF ? "doc.richtext" : "doc")
                .font(.system(size: 15, weight: .semibold))
                .foregroundColor(KoreColor.secondary)
                .frame(width: 32, height: 32)
                .background(RoundedRectangle(cornerRadius: 9, style: .continuous).fill(KoreColor.active))
            VStack(alignment: .leading, spacing: 1) {
                Text(file.name)
                    .font(.body.weight(.semibold))
                    .foregroundColor(KoreColor.text)
                    .lineLimit(2)
                Text(detail)
                    .font(.footnote)
                    .foregroundColor(KoreColor.secondary)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 16)
        .frame(minHeight: 62)
    }

    private var detail: String {
        var parts = [file.isPDF ? "PDF" : (file.url.pathExtension.uppercased())]
        if let size = try? file.url.resourceValues(forKeys: [.fileSizeKey]).fileSize {
            parts.append(ByteCountFormatter.string(fromByteCount: Int64(size), countStyle: .file))
        }
        if file.isPDF, let pages = CGPDFDocument(file.url as CFURL)?.numberOfPages, pages > 0 {
            parts.append(pages == 1 ? "1 page" : "\(pages) pages")
        }
        return parts.joined(separator: " \u{00B7} ")
    }
}
