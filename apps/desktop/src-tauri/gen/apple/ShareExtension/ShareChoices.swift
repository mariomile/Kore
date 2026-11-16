import Foundation

/// The share sheet's two choices, **how** a link is written and **where**, plus
/// what it remembers between shares and the note list it offers. Foundation
/// only, so `ShareExtensionTests` compiles it on macOS.

// MARK: - what was shared

/// What a shared link is, from its URL alone, for the kinds the sheet treats
/// differently. A conservative mirror of core's `linkKind`
/// (`packages/core/src/markdown/link-kind.ts`): X/Twitter posts and YouTube
/// videos draw as their own player, everything else as a page.
enum ShareContentKind: String {
    case post
    case video
    case page

    static func of(url: String) -> ShareContentKind {
        guard let host = URL(string: url)?.host?.lowercased() else {
            return .page
        }
        func on(_ domain: String) -> Bool {
            host == domain || host.hasSuffix(".\(domain)")
        }
        if (on("x.com") || on("twitter.com")) && xHandle(of: url) != nil {
            return .post
        }
        if on("youtube.com") || on("youtu.be") {
            return .video
        }
        return .page
    }

    /// The looks offered for this kind, in the order the sheet lists them.
    var looks: [ShareLook] {
        switch self {
        case .post: return [.link, .embed, .text]
        case .video: return [.link, .embed, .card, .text]
        case .page: return [.link, .compact, .card, .large, .text]
        }
    }

    /// The look a first share of this kind starts on.
    var defaultLook: ShareLook {
        switch self {
        case .post, .video: return .embed
        case .page: return .card
        }
    }

    /// The `@handle` of an X post URL (`x.com/<handle>/status/<id>`), or nil.
    static func xHandle(of url: String) -> String? {
        guard let parts = URL(string: url)?.pathComponents, parts.count >= 4,
            parts[2] == "status", !parts[1].isEmpty
        else {
            return nil
        }
        return parts[1]
    }
}

/// How the link is written, as `capture-envelope.ts`'s `captureLookSchema`.
enum ShareLook: String, Codable, CaseIterable {
    case link
    case compact
    case card
    case large
    case embed
    case text

    /// The chip label; `embed` names what it draws for the kind.
    func label(for kind: ShareContentKind) -> String {
        switch self {
        case .link: return "Link"
        case .compact: return "Compact"
        case .card: return "Card"
        case .large: return "Large"
        case .embed: return kind == .video ? "Video" : "Post"
        case .text: return kind == .video ? "Transcript" : "Text"
        }
    }
}

// MARK: - where it goes

/// Where the link is written, encoded as `captureDestinationSchema`.
enum ShareDestination: Equatable {
    case daily
    case note(path: String, title: String)
    case new(title: String, folder: String)
}

extension ShareDestination: Encodable {
    private enum Keys: String, CodingKey {
        case kind, path, title, folder
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: Keys.self)
        switch self {
        case .daily:
            try container.encode("daily", forKey: .kind)
        case let .note(path, _):
            try container.encode("note", forKey: .kind)
            try container.encode(path, forKey: .path)
        case let .new(title, folder):
            try container.encode("new", forKey: .kind)
            try container.encode(title, forKey: .title)
            try container.encode(folder, forKey: .folder)
        }
    }
}

// MARK: - the note list

/// The note list the app publishes into the App Group container
/// (`packages/core/src/actions/share-targets.ts`, format version 1).
struct ShareTargets: Decodable {
    struct Note: Decodable, Equatable, Identifiable {
        let path: String
        let title: String
        let mtime: Double
        var id: String { path }

        /// The folder it sits in, for the row's second line (`''` at the root).
        var folder: String {
            let parts = path.split(separator: "/").dropLast()
            return parts.joined(separator: "/")
        }
    }

    struct Folder: Decodable, Equatable, Identifiable {
        let path: String
        let count: Int
        var id: String { path }
    }

    let version: Int
    let notes: [Note]
    let folders: [Folder]
    let newNoteFolder: String

    /// The file the app writes (`SHARE_TARGETS_FILE` in `capture.rs`).
    static let fileName = "share-targets.json"

    static let empty = ShareTargets(version: 1, notes: [], folders: [], newNoteFolder: "")

    /// Read the list from the App Group container; empty when the app has not
    /// published one yet, or published a format this build cannot read.
    static func load() -> ShareTargets {
        guard
            let container = FileManager.default.containerURL(
                forSecurityApplicationGroupIdentifier: CaptureInbox.groupId),
            let data = try? Data(contentsOf: container.appendingPathComponent(fileName)),
            let targets = try? JSONDecoder().decode(ShareTargets.self, from: data),
            targets.version == 1
        else {
            return .empty
        }
        return targets
    }

    /// Notes whose title matches `query` (case- and accent-insensitive),
    /// titles that start with it first, then the most recently edited. An
    /// empty query lists the most recent notes.
    func search(_ query: String, limit: Int = 50) -> [Note] {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !needle.isEmpty else {
            return Array(notes.prefix(limit))
        }
        let options: String.CompareOptions = [.caseInsensitive, .diacriticInsensitive]
        var leading: [Note] = []
        var inside: [Note] = []
        for note in notes {
            guard let range = note.title.range(of: needle, options: options) else {
                continue
            }
            if range.lowerBound == note.title.startIndex {
                leading.append(note)
            } else {
                inside.append(note)
            }
            if leading.count >= limit {
                break
            }
        }
        return Array((leading + inside).prefix(limit))
    }
}

// MARK: - what the sheet remembers

/// The last choices, so a repeat share is one tap. Kept in the App Group's
/// defaults; nothing here is content, only paths and look names.
struct SharePreferences {
    private let defaults: UserDefaults

    init(defaults: UserDefaults? = UserDefaults(suiteName: CaptureInbox.groupId)) {
        self.defaults = defaults ?? .standard
    }

    func look(for kind: ShareContentKind) -> ShareLook {
        guard let raw = defaults.string(forKey: "share.look.\(kind.rawValue)"),
            let look = ShareLook(rawValue: raw), kind.looks.contains(look)
        else {
            return kind.defaultLook
        }
        return look
    }

    func remember(look: ShareLook, for kind: ShareContentKind) {
        defaults.set(look.rawValue, forKey: "share.look.\(kind.rawValue)")
    }

    /// The last destination, re-checked against the current note list. A new
    /// note's title is the page's own each time, so only its folder is kept.
    func destination(pageTitle: String, targets: ShareTargets) -> ShareDestination {
        switch defaults.string(forKey: "share.where") {
        case "note":
            guard let path = defaults.string(forKey: "share.note"),
                let note = targets.notes.first(where: { $0.path == path })
            else {
                return .daily
            }
            return .note(path: note.path, title: note.title)
        case "new":
            return .new(title: pageTitle, folder: folder(targets: targets))
        default:
            return .daily
        }
    }

    /// The folder a new note goes in: the last one used, else the vault's own.
    func folder(targets: ShareTargets) -> String {
        defaults.string(forKey: "share.folder") ?? targets.newNoteFolder
    }

    func remember(destination: ShareDestination) {
        switch destination {
        case .daily:
            defaults.set("daily", forKey: "share.where")
        case let .note(path, _):
            defaults.set("note", forKey: "share.where")
            defaults.set(path, forKey: "share.note")
        case let .new(_, folder):
            defaults.set("new", forKey: "share.where")
            defaults.set(folder, forKey: "share.folder")
        }
    }
}
