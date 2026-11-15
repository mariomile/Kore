import Foundation

/// What the daily-note home-screen widget shows: a small digest of today's
/// note, computed by the app (`packages/core/src/actions/daily-widget.ts`,
/// keep the fields in sync) and stored in the App Group container so the
/// widget extension never touches the vault. Compiled into both the
/// recording plugin (writer) and the widget extension (reader).
struct DailyWidgetSnapshot: Codable {
  /// The daily note's date, `YYYY-MM-DD` in the device's time zone.
  let date: String
  /// A plain-text preview of the note's prose (tasks excluded), possibly empty.
  let preview: String
  /// Open task texts, in document order, capped by the app.
  let openTasks: [String]
  /// All open tasks in the note (may exceed `openTasks.count`).
  let openTaskCount: Int
  let doneTaskCount: Int
}

/// The shared file the app writes and the widget reads.
enum DailyWidgetStore {
  /// The widget's `kind`, for targeted timeline reloads.
  static let widgetKind = "app.kore.daily-note"

  /// Must match the `com.apple.security.application-groups` entitlement.
  /// Picked from the bundle id rather than `#if DEBUG`, because this file
  /// builds both inside SwiftPM (the plugin) and Xcode (the widget): the dev
  /// flavor's ids (`app.kore.ios.dev`, `.dev.widgets`) use the dev group.
  static var groupId: String {
    let bundle = Bundle.main.bundleIdentifier ?? ""
    return bundle.hasPrefix("app.kore.ios.dev") ? "group.app.kore.dev" : "group.app.kore"
  }

  static var fileURL: URL? {
    FileManager.default
      .containerURL(forSecurityApplicationGroupIdentifier: groupId)?
      .appendingPathComponent("widgets", isDirectory: true)
      .appendingPathComponent("daily.json")
  }

  static func read() -> DailyWidgetSnapshot? {
    guard let url = fileURL, let data = try? Data(contentsOf: url) else { return nil }
    return try? JSONDecoder().decode(DailyWidgetSnapshot.self, from: data)
  }

  /// Validate and store a snapshot the app serialized. Throws on a payload
  /// that doesn't decode, so a shape drift fails loudly in the app instead of
  /// silently blanking the widget.
  static func write(json: String) throws {
    let data = Data(json.utf8)
    _ = try JSONDecoder().decode(DailyWidgetSnapshot.self, from: data)
    guard let url = fileURL else {
      throw NSError(
        domain: "app.kore.widgets", code: 1,
        userInfo: [NSLocalizedDescriptionKey: "the App Group container is unavailable"])
    }
    try FileManager.default.createDirectory(
      at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    try data.write(to: url, options: .atomic)
  }
}
