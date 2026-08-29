import Foundation
import UniformTypeIdentifiers
import XCTest

@testable import ShareIngress

/// Pins `ShareState`'s extraction logic: what `SharedCapture` a given set of
/// share-sheet attachments turns into. `pageCapture(from:)` and
/// `extractPlain(from:completion:)` were widened from `private` to internal
/// (see the doc comments on those two functions in `ShareState.swift`) so
/// this suite can call them directly — `@testable import` only lifts
/// `internal` access up to visible, it does not reach `private` — and there
/// is no accessible way to construct a real `NSExtensionContext` to drive
/// `save()`/`extract(from:)` from outside the extension host.
///
/// URL attachments need `FakeURLItemProvider` below: on macOS,
/// `NSItemProvider.loadItem(forTypeIdentifier: UTType.url.identifier, ...)`
/// always hands back the URL's raw `Data` representation (confirmed by
/// diffing it byte-for-byte against `NSURL.dataRepresentation`), never a
/// native `URL`/`NSURL`, no matter how the provider is registered
/// (`init(item:typeIdentifier:)`, `init(object:)`, or
/// `registerItem(forTypeIdentifier:loadHandler:)` handing back a live
/// `NSURL` all reproduce it) — confirmed to be specific to that one API,
/// since `loadObject(ofClass: NSURL.self)` decodes the very same registration
/// correctly. `extractPlain`'s production code calls exactly `loadItem`, so a
/// plain provider can never reach its `sharedUrlString` branch here — plain
/// text attachments are unaffected and use real `NSItemProvider`.
final class ShareStateTests: XCTestCase {
    // MARK: - Safari rich case (JS preprocessor results)

    func testPageCaptureExtractsSafarisRichResultWithTitleAndSelection() throws {
        let results: NSDictionary = [
            "url": "https://example.com/article",
            "title": "An Article",
            "selection": "the selected passage",
            "description": "the meta description",
        ]
        let item: NSDictionary = [NSExtensionJavaScriptPreprocessingResultsKey: results]

        let capture = try XCTUnwrap(ShareState.pageCapture(from: item))
        guard case let .link(url, title, selection, metaDescription) = capture else {
            return XCTFail("expected a .link capture, got \(capture)")
        }
        XCTAssertEqual(url, "https://example.com/article")
        XCTAssertEqual(title, "An Article")
        XCTAssertEqual(selection, "the selected passage")
        XCTAssertEqual(metaDescription, "the meta description")
    }

    func testPageCaptureFallsBackToNilForAMalformedDictionary() {
        let item: NSDictionary = ["unexpected": "shape"]
        XCTAssertNil(
            ShareState.pageCapture(from: item),
            "a malformed preprocessing result must fall back to plain extraction, not crash or fabricate a capture"
        )
    }

    func testPageCaptureRejectsANonHttpUrl() {
        // Safari can run the preprocessor on non-web pages (chrome://,
        // about:); those must not spool as a link.
        let results: NSDictionary = ["url": "chrome://settings", "title": "Settings"]
        let item: NSDictionary = [NSExtensionJavaScriptPreprocessingResultsKey: results]
        XCTAssertNil(ShareState.pageCapture(from: item))
    }

    // MARK: - Chrome's bare-URL + plain-text-sibling case

    func testExtractPlainReadsTitleFromThePlainTextSiblingForABareUrl() async throws {
        // Chrome shares a URL item plus the page title as a separate
        // plain-text attachment (rather than Safari's rich JS-preprocessor
        // payload) — that's why the extension's activation rule needs
        // dictionary version 2 (subset matching).
        let urlProvider = FakeURLItemProvider(fakeURL: NSURL(string: "https://example.com/page")!)
        let titleProvider = NSItemProvider(
            item: "Example Domain" as NSString, typeIdentifier: UTType.plainText.identifier)

        let capture = try await extractPlain([urlProvider, titleProvider])
        guard case let .link(url, title, selection, metaDescription) = try XCTUnwrap(capture) else {
            return XCTFail("expected a .link capture")
        }
        XCTAssertEqual(url, "https://example.com/page")
        XCTAssertEqual(title, "Example Domain")
        XCTAssertNil(selection, "extractPlain's URL path never has a selection — only Safari's JS preprocessor does")
        XCTAssertNil(metaDescription)
    }

    func testExtractPlainDefaultsToAnEmptyTitleWithoutAPlainTextSibling() async throws {
        let urlProvider = FakeURLItemProvider(fakeURL: NSURL(string: "https://example.com/page")!)

        let capture = try await extractPlain([urlProvider])
        guard case let .link(url, title, _, _) = try XCTUnwrap(capture) else {
            return XCTFail("expected a .link capture")
        }
        XCTAssertEqual(url, "https://example.com/page")
        XCTAssertEqual(title, "")
    }

    func testExtractPlainKeepsANonHttpUrlItemAsText() async throws {
        // A mailto:/app URL isn't a capturable web page — it must still
        // save as something (as text) rather than fail the share outright.
        let provider = FakeURLItemProvider(fakeURL: NSURL(string: "mailto:foo@example.com")!)

        let capture = try await extractPlain([provider])
        guard case let .text(text) = try XCTUnwrap(capture) else {
            return XCTFail("expected a .text capture")
        }
        XCTAssertEqual(text, "mailto:foo@example.com")
    }

    // MARK: - Plain-text case

    func testExtractPlainTreatsOrdinaryTextAsATextCapture() async throws {
        let provider = NSItemProvider(
            item: "Just a note to self" as NSString, typeIdentifier: UTType.plainText.identifier)

        let capture = try await extractPlain([provider])
        guard case let .text(text) = try XCTUnwrap(capture) else {
            return XCTFail("expected a .text capture")
        }
        XCTAssertEqual(text, "Just a note to self")
    }

    func testExtractPlainTreatsABareUrlPastedAsTextAsALink() async throws {
        // A URL pasted/selected as plain text (no separate URL attachment)
        // still saves as a link, not a bullet.
        let provider = NSItemProvider(
            item: "https://example.com/path" as NSString, typeIdentifier: UTType.plainText.identifier)

        let capture = try await extractPlain([provider])
        guard case let .link(url, title, selection, metaDescription) = try XCTUnwrap(capture) else {
            return XCTFail("expected a .link capture")
        }
        XCTAssertEqual(url, "https://example.com/path")
        XCTAssertEqual(title, "")
        XCTAssertNil(selection)
        XCTAssertNil(metaDescription)
    }

    func testExtractPlainReturnsNilWhenThereIsNothingUsable() async throws {
        let capture = try await extractPlain([])
        XCTAssertNil(capture)
    }

    // MARK: - helpers

    /// Bridges `ShareState.extractPlain`'s completion-handler API (provider
    /// callbacks "arrive on arbitrary queues", per its doc comment) to
    /// `async/await` for the tests above.
    private func extractPlain(_ attachments: [NSItemProvider]) async throws -> SharedCapture? {
        try await withCheckedThrowingContinuation { continuation in
            ShareState.extractPlain(from: attachments) { capture in
                continuation.resume(returning: capture)
            }
        }
    }
}

/// A test double standing in for a "public.url"-typed `NSItemProvider` on
/// macOS. `loadItem(forTypeIdentifier:options:completionHandler:)` is
/// overridable (it is dynamically dispatched, so `extractPlain`'s call
/// resolves to this override just like it would any other `NSItemProvider`
/// subclass), so this hands back the real `NSURL` directly instead of
/// going through the OS's raw-Data round trip documented on
/// `ShareStateTests` above. This changes nothing about how `extractPlain`
/// itself works — the class under test still calls the same API the same
/// way; only the double answering that call differs from a plain
/// `NSItemProvider` on this platform.
private final class FakeURLItemProvider: NSItemProvider, @unchecked Sendable {
    let fakeURL: NSURL

    init(fakeURL: NSURL) {
        self.fakeURL = fakeURL
        super.init()
        registerItem(forTypeIdentifier: UTType.url.identifier) { completion, _, _ in
            completion?(fakeURL, nil)
        }
    }

    override func loadItem(
        forTypeIdentifier typeIdentifier: String,
        options: [AnyHashable: Any]? = nil,
        completionHandler: NSItemProvider.CompletionHandler? = nil
    ) {
        guard typeIdentifier == UTType.url.identifier else {
            return super.loadItem(forTypeIdentifier: typeIdentifier, options: options, completionHandler: completionHandler)
        }
        completionHandler?(fakeURL, nil)
    }
}
