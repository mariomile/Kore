import SwiftUI
import WidgetKit

/// One timeline entry: the stored digest (if any) as of `date`.
struct DailyNoteEntry: TimelineEntry {
  let date: Date
  let snapshot: DailyWidgetSnapshot?
}

/// Reads the digest the app stores in the App Group (`DailyWidgetStore`).
/// The app reloads this timeline whenever today's note changes; the only
/// scheduled refresh is midnight, when "today" turns into a new, empty day.
struct DailyNoteProvider: TimelineProvider {
  func placeholder(in context: Context) -> DailyNoteEntry {
    DailyNoteEntry(
      date: .now,
      snapshot: DailyWidgetSnapshot(
        date: DailyNoteProvider.dayKey(.now),
        preview: "Morning pages, ideas, and what happened today.",
        openTasks: ["Review the roadmap", "Call the bank"],
        openTaskCount: 2,
        doneTaskCount: 1))
  }

  func getSnapshot(in context: Context, completion: @escaping (DailyNoteEntry) -> Void) {
    completion(
      context.isPreview && DailyWidgetStore.read() == nil
        ? placeholder(in: context)
        : DailyNoteEntry(date: .now, snapshot: DailyWidgetStore.read()))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<DailyNoteEntry>) -> Void) {
    let now = Date.now
    let snapshot = DailyWidgetStore.read()
    let midnight = Calendar.current.startOfDay(for: now).addingTimeInterval(24 * 60 * 60)
    completion(
      Timeline(
        entries: [
          DailyNoteEntry(date: now, snapshot: snapshot),
          DailyNoteEntry(date: midnight, snapshot: snapshot),
        ],
        policy: .after(midnight)))
  }

  /// `YYYY-MM-DD` in the device's time zone — the daily note's file date.
  static func dayKey(_ date: Date) -> String {
    let parts = Calendar.current.dateComponents([.year, .month, .day], from: date)
    return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
  }
}

/// The daily-note widget: today's date, the first open tasks and a preview.
/// Tapping opens today's note (`kore://daily`); the medium and large sizes
/// add a record button (`kore://record-audio`).
struct DailyNoteWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: DailyWidgetStore.widgetKind, provider: DailyNoteProvider()) { entry in
      DailyNoteWidgetView(entry: entry)
        .widgetURL(URL(string: "kore://daily"))
        .widgetBackgroundCompat()
    }
    .configurationDisplayName("Today")
    .description("Today's daily note: open tasks and the latest lines.")
    .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
  }
}

struct DailyNoteWidgetView: View {
  @Environment(\.widgetFamily) private var family
  let entry: DailyNoteEntry

  /// The stored digest only counts when it is about the entry's day.
  private var today: DailyWidgetSnapshot? {
    guard let snapshot = entry.snapshot,
      snapshot.date == DailyNoteProvider.dayKey(entry.date)
    else { return nil }
    return snapshot
  }

  private var taskLimit: Int {
    switch family {
    case .systemSmall: return 3
    case .systemMedium: return 3
    default: return 8
    }
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      header
      if let today, !(today.openTasks.isEmpty && today.preview.isEmpty) {
        content(today)
      } else {
        Text("Nothing yet today. Tap to write.")
          .font(.footnote)
          .foregroundStyle(.secondary)
      }
      Spacer(minLength: 0)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }

  private var header: some View {
    HStack(alignment: .firstTextBaseline) {
      VStack(alignment: .leading, spacing: 0) {
        Text(entry.date, format: .dateTime.weekday(.wide))
          .font(.caption.weight(.semibold))
          .foregroundStyle(.red)
          .textCase(.uppercase)
        Text(entry.date, format: .dateTime.day().month(.wide))
          .font(family == .systemSmall ? .headline : .title3.weight(.semibold))
      }
      Spacer(minLength: 4)
      if family != .systemSmall {
        Link(destination: URL(string: "kore://record-audio")!) {
          Image(systemName: "mic.fill")
            .font(.body.weight(.semibold))
            .foregroundStyle(.white)
            .frame(width: 32, height: 32)
            .background(Circle().fill(.red))
        }
        .accessibilityLabel("Record audio memo")
      }
    }
  }

  @ViewBuilder
  private func content(_ snapshot: DailyWidgetSnapshot) -> some View {
    let tasks = Array(snapshot.openTasks.prefix(taskLimit))
    ForEach(Array(tasks.enumerated()), id: \.offset) { _, task in
      HStack(alignment: .firstTextBaseline, spacing: 6) {
        Image(systemName: "circle")
          .font(.caption2)
          .foregroundStyle(.secondary)
        Text(task)
          .font(.footnote)
          .lineLimit(1)
      }
    }
    if snapshot.openTaskCount > tasks.count {
      Text("+\(snapshot.openTaskCount - tasks.count) more")
        .font(.caption2)
        .foregroundStyle(.secondary)
    }
    if !snapshot.preview.isEmpty && (family != .systemSmall || tasks.isEmpty) {
      Text(snapshot.preview)
        .font(.footnote)
        .foregroundStyle(.secondary)
        .lineLimit(family == .systemLarge ? 8 : (tasks.isEmpty ? 4 : 2))
    }
  }
}
