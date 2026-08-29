import XCTest

@testable import ShareIngress

/// Pins `CaptureInbox`'s wire shape and behavior against
/// `packages/core/src/actions/capture-envelope.ts`, the documented source of
/// truth (see `CaptureInbox.swift`'s header). These tests read encoded JSON —
/// not Swift property names — so a rename, a dropped field, or a changed
/// discriminator on the Swift side turns them red.
///
/// What each schema requires (from `capture-envelope.ts` as read for this
/// suite):
/// - `captureEnvelopeSchema`: required `version` (literal 1), `id` (guid),
///   `url`, `title`, `capturedAt`, `source`; optional `selection`,
///   `contentText`, `metaDescription`, `note`, `screenshotRef`. No `kind`.
///   `source` is `z.enum(['extension', 'ios-share'])`.
/// - `textCaptureEnvelopeSchema`: all of `version`, `id`, `kind`, `text`,
///   `capturedAt`, `source` are required. `kind` is
///   `z.enum(['append', 'checkbox', 'task'])`. `source` is
///   `z.enum(['deep-link', 'ios-share', 'ios-intent', 'global-shortcut'])`.
///   `text` is `.trim().min(1).max(TEXT_CAPTURE_MAX_LENGTH)` with
///   `TEXT_CAPTURE_MAX_LENGTH = 10_000`, and must be single-line
///   (`/^[^\r\n]+$/`).
///
/// `spoolLink`/`spoolText` write into the real App Group container
/// (`~/Library/Group Containers/group.app.lore.dev/inbox`, `CaptureInbox`'s
/// debug-flavor `groupId`): a bare `swift test` binary carries no App
/// Sandbox, so `containerURL(forSecurityApplicationGroupIdentifier:)`
/// succeeds instead of returning nil the way it would inside the real
/// extension's sandbox without the entitlement. `spoolAndInspect` below
/// diffs the directory before/after each call so it only ever touches the
/// one file its own call produced, and always removes it again — this suite
/// never reads or deletes anything it didn't just write itself.
final class CaptureInboxTests: XCTestCase {
    // MARK: - LinkCaptureEnvelope wire shape (direct struct encoding)

    func testLinkEnvelopeFieldNamesMatchTheSchema() throws {
        let envelope = LinkCaptureEnvelope(
            id: "3f9e8f1a-1111-4a2b-8c3d-abcdefabcdef",
            url: "https://example.com/article",
            title: "An Article",
            selection: "selected text",
            metaDescription: "a description",
            capturedAt: "2024-01-01T00:00:00.000Z"
        )
        let json = try encodeToObject(envelope)

        XCTAssertEqual(
            Set(json.keys),
            ["version", "id", "url", "title", "selection", "metaDescription", "capturedAt", "source"],
            "LinkCaptureEnvelope must encode exactly captureEnvelopeSchema's field names — no more, no less"
        )
        XCTAssertNil(json["kind"], "link envelopes predate `kind` and must never carry one")
    }

    func testLinkEnvelopeOmitsAbsentOptionalsRatherThanEncodingNull() throws {
        // zod's `.optional()` accepts a MISSING key; it does not accept an
        // explicit `null` unless the field is also `.nullable()`. Swift's
        // synthesized Encodable uses encodeIfPresent for Optional properties,
        // which must keep omitting the key — not switch to encoding `null`.
        let envelope = LinkCaptureEnvelope(
            id: "3f9e8f1a-1111-4a2b-8c3d-abcdefabcdef",
            url: "https://example.com",
            title: "Title",
            selection: nil,
            metaDescription: nil,
            capturedAt: "2024-01-01T00:00:00.000Z"
        )
        let json = try encodeToObject(envelope)

        XCTAssertFalse(json.keys.contains("selection"))
        XCTAssertFalse(json.keys.contains("metaDescription"))
    }

    func testLinkEnvelopeVersionIsLiteralOne() throws {
        let envelope = LinkCaptureEnvelope(
            id: "3f9e8f1a-1111-4a2b-8c3d-abcdefabcdef",
            url: "https://example.com",
            title: "Title",
            selection: nil,
            metaDescription: nil,
            capturedAt: "2024-01-01T00:00:00.000Z"
        )
        let json = try encodeToObject(envelope)
        XCTAssertEqual(json["version"] as? Int, 1, "must satisfy z.literal(1)")
    }

    func testLinkEnvelopeSourceIsIosShareAndAValidSchemaMember() throws {
        // captureSourceSchema = z.enum(['extension', 'ios-share']) — the iOS
        // extension is only ever the second member.
        let envelope = LinkCaptureEnvelope(
            id: "3f9e8f1a-1111-4a2b-8c3d-abcdefabcdef",
            url: "https://example.com",
            title: "Title",
            selection: nil,
            metaDescription: nil,
            capturedAt: "2024-01-01T00:00:00.000Z"
        )
        XCTAssertEqual(envelope.source, "ios-share")
        XCTAssertTrue(["extension", "ios-share"].contains(envelope.source))
    }

    // MARK: - TextCaptureEnvelope wire shape (direct struct encoding)

    func testTextEnvelopeFieldNamesMatchTheSchema() throws {
        let envelope = TextCaptureEnvelope(
            id: "3f9e8f1a-1111-4a2b-8c3d-abcdefabcdef",
            text: "hello world",
            capturedAt: "2024-01-01T00:00:00.000Z",
            source: "ios-share"
        )
        let json = try encodeToObject(envelope)

        XCTAssertEqual(
            Set(json.keys),
            ["version", "id", "kind", "text", "capturedAt", "source"],
            "TextCaptureEnvelope must encode exactly textCaptureEnvelopeSchema's field names — all are required, none optional"
        )
    }

    func testTextEnvelopeDefaultKindIsAppendAndAValidSchemaMember() throws {
        // textCaptureKindSchema = z.enum(['append', 'checkbox', 'task']).
        // ShareState only ever produces append captures.
        let envelope = TextCaptureEnvelope(
            id: "3f9e8f1a-1111-4a2b-8c3d-abcdefabcdef",
            text: "hello",
            capturedAt: "2024-01-01T00:00:00.000Z",
            source: "ios-share"
        )
        XCTAssertEqual(envelope.kind, "append")
        XCTAssertTrue(["append", "checkbox", "task"].contains(envelope.kind))
    }

    func testTextEnvelopeSourceIsAValidSchemaMember() throws {
        // textCaptureSourceSchema = z.enum(['deep-link', 'ios-share',
        // 'ios-intent', 'global-shortcut']).
        let validSources = ["deep-link", "ios-share", "ios-intent", "global-shortcut"]
        for source in ["ios-share", "ios-intent"] {
            let envelope = TextCaptureEnvelope(
                id: "3f9e8f1a-1111-4a2b-8c3d-abcdefabcdef",
                text: "hello",
                capturedAt: "2024-01-01T00:00:00.000Z",
                source: source
            )
            XCTAssertTrue(validSources.contains(envelope.source))
        }
    }

    // MARK: - foldedLine (single-line, trimmed, capped text)

    func testFoldedLineCollapsesWhitespaceAndNewlinesToSingleSpaces() {
        let folded = CaptureInbox.foldedLine("Hello\n\tworld  \r\nfoo")
        XCTAssertEqual(folded, "Hello world foo")
    }

    func testFoldedLineNeverContainsCarriageReturnOrNewline() {
        // Mirrors the schema's `.regex(/^[^\r\n]+$/, 'must be a single line')`.
        let folded = CaptureInbox.foldedLine("line one\nline two\rline three")
        XCTAssertNotNil(folded)
        XCTAssertFalse(folded!.contains("\n"))
        XCTAssertFalse(folded!.contains("\r"))
    }

    func testFoldedLineIsNilForWhitespaceOnlyInput() {
        // Mirrors `.trim().min(1)` — nothing printable means no capture.
        XCTAssertNil(CaptureInbox.foldedLine("   \n\t  \r\n "))
        XCTAssertNil(CaptureInbox.foldedLine(""))
    }

    func testFoldedLineCapsAtTextCaptureMaxLength() {
        // TEXT_CAPTURE_MAX_LENGTH = 10_000 in capture-envelope.ts; FieldCap's
        // doc comment claims `textMax` mirrors it. Plain ASCII so
        // UTF-16 count == character count.
        let oversized = String(repeating: "a", count: 15_000)
        let folded = CaptureInbox.foldedLine(oversized)
        XCTAssertNotNil(folded)
        XCTAssertEqual(folded!.utf16.count, 10_000)
    }

    // MARK: - isHttpUrl

    func testIsHttpUrlAcceptsOnlyHttpAndHttps() {
        XCTAssertTrue(CaptureInbox.isHttpUrl("https://example.com"))
        XCTAssertTrue(CaptureInbox.isHttpUrl("http://example.com"))
        XCTAssertFalse(CaptureInbox.isHttpUrl("ftp://example.com"))
        XCTAssertFalse(CaptureInbox.isHttpUrl("mailto:foo@example.com"))
        XCTAssertFalse(CaptureInbox.isHttpUrl("javascript:alert(1)"))
        XCTAssertFalse(CaptureInbox.isHttpUrl(""))
    }

    // MARK: - spoolLink / spoolText: the real end-to-end write

    func testSpoolLinkWritesExactlyTheSchemaFieldsToTheRealInbox() throws {
        let json = try spoolAndInspect {
            try CaptureInbox.spoolLink(
                url: "https://example.com/article",
                title: "A normal title",
                selection: "a normal selection",
                metaDescription: "a normal description"
            )
        }

        XCTAssertEqual(
            Set(json.keys),
            ["version", "id", "url", "title", "selection", "metaDescription", "capturedAt", "source"])
        XCTAssertEqual(json["version"] as? Int, 1)
        XCTAssertEqual(json["url"] as? String, "https://example.com/article")
        XCTAssertEqual(json["title"] as? String, "A normal title")
        XCTAssertEqual(json["selection"] as? String, "a normal selection")
        XCTAssertEqual(json["metaDescription"] as? String, "a normal description")
        XCTAssertEqual(json["source"] as? String, "ios-share")

        let id = try XCTUnwrap(json["id"] as? String)
        XCTAssertNotNil(id.range(of: Self.guidPattern, options: .regularExpression), "id must satisfy z.guid()")

        let capturedAt = try XCTUnwrap(json["capturedAt"] as? String)
        XCTAssertNotNil(
            capturedAt.range(of: Self.isoDatetimeWithOffsetPattern, options: .regularExpression),
            "capturedAt must satisfy z.iso.datetime({ offset: true })")
    }

    func testSpoolLinkShedsSelectionFirstWhenTheEnvelopeIsOversized() throws {
        // The optional fields are already capped (title/selection/
        // metaDescription) before the first encode, so only an oversized
        // *url* (uncapped by design) can push the envelope over
        // spoolMaxBytes (64 KiB). A ~54 KB url plus capped optional fields
        // exceeds that; shedding `selection` alone (~10 KB) should bring it
        // back under, so `metaDescription` must survive.
        let hugeUrl = "https://example.com/" + String(repeating: "a", count: 54_000)
        let json = try spoolAndInspect {
            try CaptureInbox.spoolLink(
                url: hugeUrl,
                title: String(repeating: "t", count: 1_500),
                selection: String(repeating: "s", count: 12_000),
                metaDescription: String(repeating: "d", count: 2_500)
            )
        }

        XCTAssertNil(json["selection"], "selection should have been shed first to bring the envelope under the spool cap")
        XCTAssertNotNil(json["metaDescription"], "metaDescription should have survived — shedding only selection was enough")
        XCTAssertEqual((json["title"] as? String)?.utf16.count, 1_000, "title must be capped to FieldCap.title")
        XCTAssertEqual((json["metaDescription"] as? String)?.utf16.count, 2_000, "metaDescription must be capped to FieldCap.description")
    }

    func testSpoolLinkFailsHonestlyWhenSheddingIsNotEnoughAndWritesNothing() throws {
        // A url so large that shedding both optional fields still leaves the
        // envelope over the cap must fail with `.envelopeTooLarge`, not
        // silently truncate the url, claim success, or leave a partial file.
        let directory = try inboxDirectory()
        let before = existingJSONFilenames(in: directory)
        let enormousUrl = "https://example.com/" + String(repeating: "a", count: 100_000)

        assertThrows(.envelopeTooLarge) {
            try CaptureInbox.spoolLink(url: enormousUrl, title: "Title", selection: nil, metaDescription: nil)
        }

        XCTAssertEqual(existingJSONFilenames(in: directory), before, "a failed spool must not leave a partial envelope behind")
    }

    func testSpoolTextReturnsFalseWithoutSpoolingForWhitespaceOnlyText() throws {
        let directory = try inboxDirectory()
        let before = existingJSONFilenames(in: directory)

        let spooled = try CaptureInbox.spoolText("   \n\t  ", source: "ios-share")

        XCTAssertFalse(spooled, "nothing printable to save must not spool anything or throw")
        XCTAssertEqual(existingJSONFilenames(in: directory), before)
    }

    func testSpoolTextWritesExactlyTheSchemaFieldsWithAppendKind() throws {
        let json = try spoolAndInspect {
            _ = try CaptureInbox.spoolText("Hello world", source: "ios-share")
        }

        XCTAssertEqual(Set(json.keys), ["version", "id", "kind", "text", "capturedAt", "source"])
        XCTAssertEqual(json["version"] as? Int, 1)
        XCTAssertEqual(json["kind"] as? String, "append")
        XCTAssertEqual(json["text"] as? String, "Hello world")
        XCTAssertEqual(json["source"] as? String, "ios-share")
    }

    // MARK: - helpers

    private static let guidPattern =
        #"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"#
    private static let isoDatetimeWithOffsetPattern =
        #"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$"#

    private func encodeToObject<T: Encodable>(_ value: T) throws -> [String: Any] {
        let data = try JSONEncoder().encode(value)
        let object = try JSONSerialization.jsonObject(with: data)
        return try XCTUnwrap(object as? [String: Any])
    }

    private func inboxDirectory() throws -> URL {
        let container = try XCTUnwrap(
            FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: CaptureInbox.groupId),
            "the App Group container must be reachable (outside a real sandbox this always succeeds) for these tests to observe real spooled envelopes"
        )
        return container.appendingPathComponent(CaptureInbox.inboxDir, isDirectory: true)
    }

    private func existingJSONFilenames(in directory: URL) -> Set<String> {
        let names = (try? FileManager.default.contentsOfDirectory(atPath: directory.path)) ?? []
        return Set(names.filter { $0.hasSuffix(".json") })
    }

    /// Runs `spool`, identifies exactly the one envelope file it wrote by
    /// diffing the real inbox directory before/after (never touching any
    /// pre-existing file), decodes its JSON, deletes it again — even if an
    /// assertion below fails — and hands the JSON back for inspection.
    private func spoolAndInspect(
        file: StaticString = #filePath, line: UInt = #line,
        _ spool: () throws -> Void
    ) throws -> [String: Any] {
        let directory = try inboxDirectory()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let before = existingJSONFilenames(in: directory)

        try spool()

        let newFiles = existingJSONFilenames(in: directory).subtracting(before)
        XCTAssertEqual(newFiles.count, 1, "expected exactly one new spooled envelope", file: file, line: line)
        let filename = try XCTUnwrap(newFiles.first, file: file, line: line)
        let fileURL = directory.appendingPathComponent(filename)
        addTeardownBlock { try? FileManager.default.removeItem(at: fileURL) }

        let data = try Data(contentsOf: fileURL)
        let object = try JSONSerialization.jsonObject(with: data)
        return try XCTUnwrap(object as? [String: Any], file: file, line: line)
    }

    /// `CaptureInboxError` isn't `Equatable` (no synthesized conformance
    /// without an explicit declaration, and the source is deliberately not
    /// touched to add one), so assert the thrown case by pattern match
    /// instead of `XCTAssertEqual`.
    private func assertThrows<T>(
        _ expected: CaptureInboxError,
        file: StaticString = #filePath,
        line: UInt = #line,
        _ expression: () throws -> T
    ) {
        XCTAssertThrowsError(try expression(), file: file, line: line) { error in
            guard let captureError = error as? CaptureInboxError else {
                XCTFail("expected a CaptureInboxError, got \(error)", file: file, line: line)
                return
            }
            switch (captureError, expected) {
            case (.containerUnavailable, .containerUnavailable), (.envelopeTooLarge, .envelopeTooLarge):
                break
            default:
                XCTFail("expected \(expected) but got \(captureError)", file: file, line: line)
            }
        }
    }
}
