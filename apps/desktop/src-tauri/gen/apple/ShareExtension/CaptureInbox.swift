import Foundation

/// The capture envelopes this extension produces and the App Group inbox it
/// spools them into — the iOS half of Plan 11's platform-agnostic capture
/// contract. The TypeScript zod schema
/// (`packages/core/src/actions/capture-envelope.ts`) is the source of truth;
/// these structs must stay in sync with it. The extension never opens the
/// graph, the Git repo, or SQLite: the inbox is the only contract, and the
/// main app relays + drains it on next launch/foreground.

/// A shared web page or URL, as `capture-envelope.ts`'s `captureEnvelopeSchema`.
struct LinkCaptureEnvelope: Encodable {
    var version = 1
    var id: String
    var url: String
    var title: String
    var selection: String?
    var metaDescription: String?
    /// The user's own words from the sheet's "Add a thought" field.
    var note: String?
    var capturedAt: String
    var source = "ios-share"
    /// How to write the link (`captureLookSchema`); nil keeps the
    /// capture-note flow an older sheet produced.
    var look: ShareLook?
    /// Where to write it (`captureDestinationSchema`); nil is today's daily.
    var destination: ShareDestination?
}

/// Shared non-URL text, as `textCaptureEnvelopeSchema`: one folded line the
/// drain appends to the capture-day daily note as a bullet. `source` names
/// the producer (`ios-share` / `ios-intent`) — provenance only, one shape.
struct TextCaptureEnvelope: Encodable {
    var version = 1
    var id: String
    var kind = "append"
    var text: String
    var capturedAt: String
    var source: String
}

/// Shared files, as `fileCaptureEnvelopeSchema`: each file is copied into the
/// inbox beside the envelope as `<id>.<n>.<ext>` (its `ref`) before the
/// envelope commits, so a committed envelope's files are always there.
struct FileCaptureEnvelope: Encodable {
    struct File: Encodable, Equatable {
        /// The spooled copy's filename in the inbox.
        var ref: String
        /// The file's own name, the attachment's name in the vault.
        var name: String
    }

    var version = 1
    var id: String
    var kind = "file"
    var files: [File]
    /// The user's own words from the sheet's "Add a thought" field.
    var note: String?
    var capturedAt: String
    var source = "ios-share"
    /// Where to write the files (`captureDestinationSchema`); nil is today's daily.
    var destination: ShareDestination?
}

enum CaptureInboxError: Error {
    /// The App Group container is unreachable — an entitlements mismatch, not
    /// a user-fixable state.
    case containerUnavailable
    /// The encoded envelope exceeds the relay's spool cap even after
    /// shedding optional fields — spooling it would only feed the
    /// quarantine, so the share fails honestly instead.
    case envelopeTooLarge
    /// A shared file is over `maxFileBytes`: too big to keep in a vault that
    /// Git backs up (GitHub refuses files over 100 MB).
    case fileTooLarge
}

/// Field caps in UTF-16 code units — the unit zod's `.max()` counts on the
/// drain side, so a capped value here can never be quarantined over length
/// there. Applied at the producer so an envelope also stays inside the
/// relay's 64 KiB spool cap. `textMax` mirrors `TEXT_CAPTURE_MAX_LENGTH`.
private enum FieldCap {
    static let title = 1_000
    static let selection = 10_000
    static let description = 2_000
    static let note = 10_000
    static let textMax = 10_000
    /// `fileCaptureEnvelopeSchema`'s `files[].name` cap.
    static let fileName = 255
}

enum CaptureInbox {
    /// Must match the `com.apple.security.application-groups` entitlement on
    /// both targets, and `SHARED_GROUP_ID` in the app's Rust relay. Debug
    /// builds are the dev flavor (see `ios.project.yml`) and use their own
    /// group so a dev install never drains the production app's inbox; the
    /// Rust side switches on `debug_assertions` the same way.
    #if DEBUG
        static let groupId = "group.app.kore.dev"
    #else
        static let groupId = "group.app.kore"
    #endif

    /// Where envelopes spool inside the container; the Rust relay reads the
    /// same directory name (`SHARED_INBOX_DIR`).
    static let inboxDir = "inbox"

    /// The relay's spool cap (`INBOX_SPOOL_MAX_BYTES` in `capture.rs`) — an
    /// envelope over it is quarantined unread, so it must never be spooled.
    static let spoolMaxBytes = 64 * 1024

    /// Files one share can carry: `FILE_CAPTURE_MAX_FILES` in the schema.
    static let maxFiles = 10

    /// The largest file a share may carry. GitHub refuses files over 100 MB,
    /// and the vault is backed up through Git; the relay's own cap
    /// (`SHARED_FILE_MAX_BYTES`) sits above this.
    static let maxFileBytes = 100 * 1024 * 1024

    /// Spool a link capture. Empty titles are allowed (the drain falls back
    /// to the URL's host); empty selections and descriptions are dropped.
    /// `look` and `destination` are the share sheet's choices; a new
    /// note's title is capped like a page title.
    static func spoolLink(
        url: String,
        title: String,
        selection: String?,
        metaDescription: String?,
        note: String? = nil,
        look: ShareLook? = nil,
        destination: ShareDestination? = nil
    ) throws {
        let id = envelopeId()
        var envelope = LinkCaptureEnvelope(
            id: id,
            url: url,
            title: capped(title, at: FieldCap.title),
            selection: nonEmpty(capped(selection ?? "", at: FieldCap.selection)),
            metaDescription: nonEmpty(capped(metaDescription ?? "", at: FieldCap.description)),
            note: nonEmpty(capped(note ?? "", at: FieldCap.note)),
            capturedAt: capturedAt(),
            look: look,
            destination: resolved(destination, fallbackTitle: title)
        )
        // The URL is the one uncapped field (truncating it would save a
        // broken link): a pathological one can outgrow the spool cap. Shed
        // the optional fields biggest-first; past that the share fails
        // honestly rather than claiming "Saved" for a file the relay can
        // only quarantine.
        var data = try JSONEncoder().encode(envelope)
        if data.count > spoolMaxBytes, envelope.selection != nil {
            envelope.selection = nil
            data = try JSONEncoder().encode(envelope)
        }
        if data.count > spoolMaxBytes, envelope.metaDescription != nil {
            envelope.metaDescription = nil
            data = try JSONEncoder().encode(envelope)
        }
        guard data.count <= spoolMaxBytes else {
            throw CaptureInboxError.envelopeTooLarge
        }
        try spool(data, id: id)
    }

    /// Spool shared files: each is copied into the inbox as `<id>.<n>.<ext>`
    /// (committed through a `.tmp` sibling, like an envelope), then the
    /// envelope naming them commits last. Anything over `maxFiles` is left
    /// out; a file over `maxFileBytes` fails the share honestly, and a
    /// failure part-way removes what this call already wrote.
    static func spoolFiles(
        _ files: [SharedFile],
        note: String? = nil,
        destination: ShareDestination? = nil
    ) throws {
        let id = envelopeId()
        let inbox = try inboxUrl()
        try FileManager.default.createDirectory(at: inbox, withIntermediateDirectories: true)
        var written: [URL] = []
        do {
            var spooled: [FileCaptureEnvelope.File] = []
            for (index, file) in files.prefix(maxFiles).enumerated() {
                let size = try file.url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
                guard size <= maxFileBytes else {
                    throw CaptureInboxError.fileTooLarge
                }
                let ref = "\(id).\(index + 1).\(spoolExtension(of: file.url))"
                let tmp = inbox.appendingPathComponent("\(ref).tmp")
                let committed = inbox.appendingPathComponent(ref)
                try FileManager.default.copyItem(at: file.url, to: tmp)
                written.append(tmp)
                try FileManager.default.moveItem(at: tmp, to: committed)
                written[written.count - 1] = committed
                let name = capped(file.name, at: FieldCap.fileName)
                spooled.append(.init(ref: ref, name: name.isEmpty ? ref : name))
            }
            let envelope = FileCaptureEnvelope(
                id: id,
                files: spooled,
                note: nonEmpty(capped(note ?? "", at: FieldCap.note)),
                capturedAt: capturedAt(),
                destination: resolved(destination, fallbackTitle: files.first?.title ?? "")
            )
            try spool(try JSONEncoder().encode(envelope), id: id)
        } catch {
            for url in written {
                try? FileManager.default.removeItem(at: url)
            }
            throw error
        }
    }

    /// Spool text as an append capture — the daily note gets a bullet.
    /// Returns false (spooling nothing) when the text folds to empty.
    /// `source` is the envelope's provenance tag; deliberately no default,
    /// so the compiler names every producer.
    static func spoolText(_ text: String, source: String) throws -> Bool {
        guard let line = foldedLine(text) else {
            return false
        }
        let id = envelopeId()
        let envelope = TextCaptureEnvelope(
            id: id, text: line, capturedAt: capturedAt(), source: source)
        try spool(try JSONEncoder().encode(envelope), id: id)
        return true
    }

    /// Only web pages are capturable as links — everything else shares as text.
    static func isHttpUrl(_ candidate: String) -> Bool {
        candidate.hasPrefix("https://") || candidate.hasPrefix("http://")
    }

    /// Whitespace runs (including newlines) fold to single spaces, capped to
    /// the schema's single-line limit — the same normalization the desktop's
    /// deep-link parser applies. Nil when nothing printable remains.
    static func foldedLine(_ text: String) -> String? {
        let folded = text
            .components(separatedBy: .whitespacesAndNewlines)
            .filter { !$0.isEmpty }
            .joined(separator: " ")
        return nonEmpty(capped(folded, at: FieldCap.textMax))
    }

    // MARK: - spooling

    /// Write one envelope atomically: a `.json.tmp` sibling first, then a
    /// same-volume rename to `<id>.json` — the relay only picks up committed
    /// `.json` files, so it can never see a half-written envelope.
    private static func spool(_ data: Data, id: String) throws {
        let inbox = try inboxUrl()
        try FileManager.default.createDirectory(at: inbox, withIntermediateDirectories: true)
        let tmp = inbox.appendingPathComponent("\(id).json.tmp")
        let committed = inbox.appendingPathComponent("\(id).json")
        try data.write(to: tmp)
        try FileManager.default.moveItem(at: tmp, to: committed)
    }

    private static func inboxUrl() throws -> URL {
        guard
            let container = FileManager.default.containerURL(
                forSecurityApplicationGroupIdentifier: groupId)
        else {
            throw CaptureInboxError.containerUnavailable
        }
        return container.appendingPathComponent(inboxDir, isDirectory: true)
    }

    // MARK: - field shaping

    /// A new note's title, capped like a page title and falling back to
    /// `fallbackTitle`; with nothing to name the note, today's daily instead.
    private static func resolved(
        _ destination: ShareDestination?, fallbackTitle: String
    ) -> ShareDestination? {
        guard case let .new(title, folder) = destination else {
            return destination
        }
        let name = capped(title, at: FieldCap.title)
        let resolved = name.isEmpty ? capped(fallbackTitle, at: FieldCap.title) : name
        return resolved.isEmpty ? .daily : .new(title: resolved, folder: folder)
    }

    /// The spooled copy's extension: the file's own, lowercased and reduced
    /// to what the schema's `ref` pattern allows (`[a-z0-9]{1,8}`).
    static func spoolExtension(of url: URL) -> String {
        let cleaned = url.pathExtension.lowercased().filter { $0.isASCII && ($0.isLetter || $0.isNumber) }
        return cleaned.isEmpty ? "bin" : String(cleaned.prefix(8))
    }

    /// Lowercased to match the producer convention (the drain's identity
    /// slice and the spool filename both derive from it).
    private static func envelopeId() -> String {
        UUID().uuidString.lowercased()
    }

    /// ISO-8601 with milliseconds — what `Date.toISOString()` produces, and
    /// what the drain's zod schema validates.
    private static func capturedAt() -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: Date())
    }

    /// Trim, then cap by UTF-16 code units (what the drain's zod `.max()`
    /// counts — `String.count` counts grapheme clusters, and an emoji-heavy
    /// share could pass a character cap yet fail the drain's). Backing off by
    /// whole `Character`s keeps the cut on a grapheme boundary.
    private static func capped(_ value: String, at limit: Int) -> String {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.utf16.count > limit else {
            return trimmed
        }
        var prefix = String(trimmed.prefix(limit))
        while prefix.utf16.count > limit {
            prefix.removeLast()
        }
        return prefix
    }

    private static func nonEmpty(_ value: String?) -> String? {
        guard let value, !value.isEmpty else {
            return nil
        }
        return value
    }
}
