import Combine
import Foundation
import UniformTypeIdentifiers

/// What one share-sheet invocation extracted, ready to spool.
enum SharedCapture {
    /// A web page or URL — from Safari's JS preprocessor (rich: title,
    /// selection, meta description) or a bare URL item (title best-effort
    /// from a plain-text sibling, the way Chrome shares).
    case link(url: String, title: String, selection: String?, metaDescription: String?)
    /// Non-URL text: becomes a bullet on today's daily note.
    case text(String)
    /// Photos and PDFs: copied into the vault and embedded where the user picks.
    case files([SharedFile])
}

enum ShareStatus: Equatable {
    /// Reading the shared item (a blink: no network is involved).
    case loading
    /// Waiting on the user's choices; Save is one tap away.
    case ready
    case saved
    case failed(ShareFailure)
}

/// Why a share could not be saved, for the one line under "Couldn't save".
enum ShareFailure: Equatable {
    /// Nothing usable was shared, or the inbox could not be written.
    case generic
    /// A shared file is over `CaptureInbox.maxFileBytes`.
    case fileTooLarge
}

/// The share sheet's one flow: extract the shared item, let the user pick
/// how and where (pre-filled from the last share, so a repeat is one tap),
/// spool an envelope into the App Group inbox, report. Entirely offline:
/// saving never waits on the network, which is the point of the envelope
/// model (the main app relays, drains, and enriches later; see
/// `docs/porting/upstream-mobile/share-extension.md`).
final class ShareState: ObservableObject {
    @Published var status = ShareStatus.loading
    @Published private(set) var capture: SharedCapture?
    @Published var look = ShareLook.card
    @Published var destination = ShareDestination.daily
    @Published var thought = ""
    /// How many shared files are left out over `CaptureInbox.maxFiles`.
    @Published private(set) var filesLeftOut = 0

    var extensionContext: NSExtensionContext?

    /// The note list the app last published, read once per share.
    private(set) lazy var targets = ShareTargets.load()
    private let preferences = SharePreferences()

    /// Single-flight guards: SwiftUI can fire `onAppear` more than once, and a
    /// second save would mint a fresh envelope id, a duplicate capture.
    private var started = false
    private var saving = false

    /// How long the "Saved" confirmation stays up before the sheet dismisses
    /// itself: long enough to read, short enough to keep the flow two-tap.
    private static let dismissDelay: TimeInterval = 0.7

    /// What the shared link is (nil for plain text).
    var kind: ShareContentKind? {
        guard case let .link(url, _, _, _) = capture else {
            return nil
        }
        return ShareContentKind.of(url: url)
    }

    /// The shared files (empty for a link or text).
    var files: [SharedFile] {
        guard case let .files(files) = capture else {
            return []
        }
        return files
    }

    /// Whether the user picks where this share goes: links and files do,
    /// plain text always lands on today's daily.
    var hasDestination: Bool {
        kind != nil || !files.isEmpty
    }

    /// Whether today's daily files it under its Links section: web pages
    /// and videos do; a post, a photo or a PDF goes in the day's own notes
    /// (`DailySpot` in core's `placed-capture.ts`).
    var landsUnderLinks: Bool {
        kind == .page || kind == .video
    }

    /// What was shared, as the sheet's small print names it
    /// ("The post goes at the end of the note.").
    var noun: String {
        let files = self.files
        if !files.isEmpty {
            let many = files.count > 1
            if files.allSatisfy(\.isImage) { return many ? "photos" : "photo" }
            if files.allSatisfy(\.isPDF) { return many ? "PDFs" : "PDF" }
            return "files"
        }
        switch kind {
        case .post: return "post"
        case .video: return "video"
        default: return "link"
        }
    }

    /// The page's title, or the first file's name: the default name of a new note.
    var pageTitle: String {
        switch capture {
        case let .link(url, title, _, _):
            let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
            return trimmed.isEmpty ? (URL(string: url)?.host ?? url) : trimmed
        case let .files(files):
            return files.first?.title ?? ""
        default:
            return ""
        }
    }

    func load() {
        guard !started else {
            return
        }
        started = true
        guard let context = extensionContext else {
            return update(.failed(.generic))
        }
        Self.extract(from: context) { [weak self] capture, leftOut in
            DispatchQueue.main.async {
                guard let self else {
                    return
                }
                guard let capture else {
                    return self.update(.failed(.generic))
                }
                self.capture = capture
                self.filesLeftOut = leftOut
                if let kind = self.kind {
                    self.look = self.preferences.look(for: kind)
                }
                if self.hasDestination {
                    self.destination = self.preferences.destination(
                        pageTitle: self.pageTitle, targets: self.targets)
                }
                self.status = .ready
            }
        }
    }

    /// Pick a new note in the remembered folder, named after the page.
    func chooseNewNote() {
        destination = .new(title: pageTitle, folder: preferences.folder(targets: targets))
    }

    func save() {
        guard status == .ready, !saving, let capture else {
            return
        }
        saving = true
        let note = thought.trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            switch capture {
            case let .link(url, title, selection, metaDescription):
                try CaptureInbox.spoolLink(
                    url: url,
                    title: title,
                    selection: selection,
                    metaDescription: metaDescription,
                    note: note.isEmpty ? nil : note,
                    look: look,
                    destination: destination
                )
                if let kind {
                    preferences.remember(look: look, for: kind)
                }
                preferences.remember(destination: destination)
            case let .text(text):
                let line = note.isEmpty ? text : "\(text) · \(note)"
                guard try CaptureInbox.spoolText(line, source: "ios-share") else {
                    return update(.failed(.generic)) // nothing printable to save
                }
            case let .files(files):
                try CaptureInbox.spoolFiles(
                    files, note: note.isEmpty ? nil : note, destination: destination)
                preferences.remember(destination: destination)
            }
            update(.saved)
            DispatchQueue.main.asyncAfter(deadline: .now() + Self.dismissDelay) { [weak self] in
                self?.dismiss()
            }
        } catch CaptureInboxError.fileTooLarge {
            saving = false
            update(.failed(.fileTooLarge))
        } catch {
            saving = false
            update(.failed(.generic))
        }
    }

    func dismiss() {
        SharedFiles.discard(files)
        extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
    }

    private func update(_ status: ShareStatus) {
        if Thread.isMainThread {
            self.status = status
        } else {
            DispatchQueue.main.async {
                self.status = status
            }
        }
    }

    // MARK: - extraction

    /// Pull the shared content out of the extension context. Provider load
    /// callbacks arrive on arbitrary queues; `completion` may too.
    /// `completion` also gets how many shared files were left out over
    /// `CaptureInbox.maxFiles` (zero for anything but files).
    private static func extract(
        from context: NSExtensionContext,
        completion: @escaping (SharedCapture?, Int) -> Void
    ) {
        let attachments = context.inputItems
            .compactMap { $0 as? NSExtensionItem }
            .flatMap { $0.attachments ?? [] }
        guard !attachments.isEmpty else {
            return completion(nil, 0)
        }

        // Safari web pages: the JS preprocessor's property-list results carry
        // the richest capture (title, selection, meta description).
        if let provider = first(of: attachments, conformingTo: UTType.propertyList.identifier) {
            provider.loadItem(forTypeIdentifier: UTType.propertyList.identifier, options: nil) {
                item, _ in
                if let capture = pageCapture(from: item) {
                    completion(capture, 0)
                } else {
                    // Malformed preprocessing results must not fail a share
                    // that also carries a plain URL or text attachment.
                    extractPlain(from: attachments) { completion($0, 0) }
                }
            }
            return
        }

        // Photos and PDFs, unless the share is really a web link that
        // carries a preview image (a link is what the user meant then).
        let fileProviders = attachments.filter(SharedFiles.isSharedFile)
        if !fileProviders.isEmpty, !attachments.contains(where: SharedFiles.isWebUrl) {
            let kept = Array(fileProviders.prefix(CaptureInbox.maxFiles))
            return SharedFiles.extract(from: kept) { files in
                completion(files.isEmpty ? nil : .files(files), fileProviders.count - kept.count)
            }
        }
        extractPlain(from: attachments) { completion($0, 0) }
    }

    /// The non-Safari extraction paths: a URL attachment (title best-effort
    /// from a plain-text sibling), else plain text.
    ///
    /// Not `private`: `ShareIngressTests` (see `gen/apple/ShareExtensionTests`)
    /// calls this directly to pin extraction behavior without needing a real
    /// `NSExtensionContext`, which has no accessible test initializer.
    static func extractPlain(
        from attachments: [NSItemProvider],
        completion: @escaping (SharedCapture?) -> Void
    ) {
        // A URL item; Chrome and friends share the page title as a separate
        // plain-text attachment (why the activation rule needs dictionary
        // version 2), so read it best-effort.
        if let provider = first(of: attachments, conformingTo: UTType.url.identifier) {
            let titleProvider = attachments.first {
                $0 !== provider && $0.hasItemConformingToTypeIdentifier(UTType.plainText.identifier)
            }
            provider.loadItem(forTypeIdentifier: UTType.url.identifier, options: nil) { item, _ in
                guard let url = sharedUrlString(item) else {
                    return completion(nil)
                }
                guard CaptureInbox.isHttpUrl(url) else {
                    // Not a web page (mailto:, an app URL): keep it as text
                    // rather than dropping the share.
                    return completion(.text(url))
                }
                guard let titleProvider else {
                    return completion(.link(url: url, title: "", selection: nil, metaDescription: nil))
                }
                titleProvider.loadItem(forTypeIdentifier: UTType.plainText.identifier, options: nil) {
                    titleItem, _ in
                    let title = titleItem as? String ?? ""
                    completion(.link(url: url, title: title, selection: nil, metaDescription: nil))
                }
            }
            return
        }

        // Plain text: a pasted URL saves as a link, anything else as a bullet.
        if let provider = first(of: attachments, conformingTo: UTType.plainText.identifier) {
            provider.loadItem(forTypeIdentifier: UTType.plainText.identifier, options: nil) {
                item, _ in
                guard let text = item as? String else {
                    return completion(nil)
                }
                let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
                if CaptureInbox.isHttpUrl(trimmed), !trimmed.contains(" "),
                    URL(string: trimmed) != nil
                {
                    completion(.link(url: trimmed, title: "", selection: nil, metaDescription: nil))
                } else {
                    completion(.text(text))
                }
            }
            return
        }

        completion(nil)
    }

    private static func first(
        of attachments: [NSItemProvider],
        conformingTo identifier: String
    ) -> NSItemProvider? {
        attachments.first { $0.hasItemConformingToTypeIdentifier(identifier) }
    }

    private static func sharedUrlString(_ item: NSSecureCoding?) -> String? {
        if let url = item as? URL {
            return url.absoluteString
        }
        if let url = item as? NSURL {
            return url.absoluteString
        }
        return nil
    }

    /// Decode the JS preprocessor's results. `nil` for a malformed dictionary
    /// (or a page the preprocessor couldn't run on) — the caller then falls
    /// back to the plain URL/text attachments instead of failing the share.
    ///
    /// Not `private`: `ShareIngressTests` (see `gen/apple/ShareExtensionTests`)
    /// calls this directly to pin extraction behavior without needing a real
    /// `NSExtensionContext`, which has no accessible test initializer.
    static func pageCapture(from item: NSSecureCoding?) -> SharedCapture? {
        guard
            let dict = item as? NSDictionary,
            let results = dict[NSExtensionJavaScriptPreprocessingResultsKey] as? NSDictionary,
            let url = results["url"] as? String,
            CaptureInbox.isHttpUrl(url)
        else {
            return nil
        }
        return .link(
            url: url,
            title: results["title"] as? String ?? "",
            selection: results["selection"] as? String,
            metaDescription: results["description"] as? String
        )
    }
}
