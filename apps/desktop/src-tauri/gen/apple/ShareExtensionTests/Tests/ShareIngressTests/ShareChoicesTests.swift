import XCTest

@testable import ShareIngress

/// Pins the share sheet's choices against `capture-envelope.ts`
/// (`captureLookSchema`, `captureDestinationSchema`) and the note list the
/// app publishes (`share-targets.ts`).
final class ShareChoicesTests: XCTestCase {
    func testContentKindTreatsXPostsAndYouTubeAsPlayersAndEverythingElseAsAPage() {
        XCTAssertEqual(ShareContentKind.of(url: "https://x.com/someone/status/123?s=20"), .post)
        XCTAssertEqual(ShareContentKind.of(url: "https://mobile.twitter.com/someone/status/1"), .post)
        XCTAssertEqual(ShareContentKind.of(url: "https://x.com/someone"), .page)
        XCTAssertEqual(ShareContentKind.of(url: "https://www.youtube.com/watch?v=abc"), .video)
        XCTAssertEqual(ShareContentKind.of(url: "https://youtu.be/abc"), .video)
        XCTAssertEqual(ShareContentKind.of(url: "https://example.com/x.com/a/status/1"), .page)
        XCTAssertEqual(ShareContentKind.xHandle(of: "https://x.com/someone/status/123"), "someone")
        XCTAssertEqual(ShareContentKind.post.defaultLook, .text)
        XCTAssertEqual(ShareContentKind.post.looks, [.link, .text, .embed])
        XCTAssertEqual(ShareLook.text.label(for: .post), "Post")
        XCTAssertEqual(ShareLook.embed.label(for: .post), "Embed")
        XCTAssertEqual(ShareContentKind.page.looks, [.link, .compact, .card, .large, .text])
    }

    func testLookRawValuesAreExactlyTheSchemaMembers() {
        XCTAssertEqual(
            Set(ShareLook.allCases.map(\.rawValue)),
            ["link", "card", "compact", "large", "embed", "text"])
    }

    func testDestinationsEncodeAsTheSchemaShapes() throws {
        XCTAssertEqual(try encode(ShareDestination.daily), ["kind": "daily"])
        XCTAssertEqual(
            try encode(ShareDestination.note(path: "Projects/Kore.md", title: "Kore")),
            ["kind": "note", "path": "Projects/Kore.md"])
        XCTAssertEqual(
            try encode(ShareDestination.new(title: "Bitter lesson", folder: "Input")),
            ["kind": "new", "title": "Bitter lesson", "folder": "Input"])
    }

    func testLinkEnvelopeCarriesTheChoicesAndTheThought() throws {
        let envelope = LinkCaptureEnvelope(
            id: "3f9e8f1a-1111-4a2b-8c3d-abcdefabcdef",
            url: "https://example.com",
            title: "Title",
            note: "why I saved it",
            capturedAt: "2024-01-01T00:00:00.000Z",
            look: .large,
            destination: .new(title: "Title", folder: "")
        )
        let data = try JSONEncoder().encode(envelope)
        let json = try XCTUnwrap(try JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(json["look"] as? String, "large")
        XCTAssertEqual(json["note"] as? String, "why I saved it")
        XCTAssertEqual((json["destination"] as? [String: String])?["kind"], "new")
    }

    func testTargetsDecodeTheAppSnapshotAndSearchTitlesStartingWithTheQueryFirst() throws {
        let snapshot = """
            {"version":1,"newNoteFolder":"notes",
             "notes":[{"path":"a/Weekly review.md","title":"Weekly review","mtime":3},
                      {"path":"Kore.md","title":"Kore","mtime":2},
                      {"path":"b/Città.md","title":"Città e review","mtime":1}],
             "folders":[{"path":"a","count":1}]}
            """
        let targets = try JSONDecoder().decode(ShareTargets.self, from: Data(snapshot.utf8))
        XCTAssertEqual(targets.search("").map(\.title), ["Weekly review", "Kore", "Città e review"])
        XCTAssertEqual(targets.search("REVIEW").map(\.title), ["Weekly review", "Città e review"])
        XCTAssertEqual(targets.search("citta").map(\.title), ["Città e review"])
        XCTAssertEqual(targets.notes.first?.folder, "a")
        XCTAssertEqual(targets.notes[1].folder, "")
    }

    func testPreferencesRememberTheLastChoicesAndDropANoteThatIsGone() throws {
        let suite = "share-choices-tests-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let preferences = SharePreferences(defaults: defaults)
        let kore = ShareTargets.Note(path: "Kore.md", title: "Kore", mtime: 1)
        let targets = ShareTargets(version: 1, notes: [kore], folders: [], newNoteFolder: "notes")

        XCTAssertEqual(preferences.look(for: .page), .card)
        XCTAssertEqual(preferences.destination(pageTitle: "Page", targets: targets), .daily)

        preferences.remember(look: .large, for: .page)
        preferences.remember(destination: .note(path: "Kore.md", title: "Kore"))
        XCTAssertEqual(preferences.look(for: .page), .large)
        XCTAssertEqual(preferences.look(for: .post), .text)
        // The embed an older sheet remembered as its default is not a choice.
        defaults.set("embed", forKey: "share.look.post")
        XCTAssertEqual(preferences.look(for: .post), .text)
        preferences.remember(look: .embed, for: .post)
        XCTAssertEqual(preferences.look(for: .post), .embed)
        XCTAssertEqual(
            preferences.destination(pageTitle: "Page", targets: targets),
            .note(path: "Kore.md", title: "Kore"))
        XCTAssertEqual(preferences.destination(pageTitle: "Page", targets: .empty), .daily)

        preferences.remember(destination: .new(title: "Old", folder: "Input"))
        XCTAssertEqual(
            preferences.destination(pageTitle: "Page", targets: targets),
            .new(title: "Page", folder: "Input"))
    }

    private func encode(_ destination: ShareDestination) throws -> [String: String] {
        let data = try JSONEncoder().encode(destination)
        return try XCTUnwrap(try JSONSerialization.jsonObject(with: data) as? [String: String])
    }
}
