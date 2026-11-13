import SwiftUI
import WidgetKit

/// The widget extension's entry point: the daily-note widget, the lock-screen
/// / home-screen "record" widget, and the recording Live Activity. Swift only —
/// no Rust, no webview; both surfaces hand off to the main app (the widget
/// through `kore://record-audio`, the activity's stop button through an
/// in-process `LiveActivityIntent`).
@main
struct ReflectWidgetBundle: WidgetBundle {
  var body: some Widget {
    DailyNoteWidget()
    RecordAudioWidget()
    RecordingActivityWidget()
  }
}
