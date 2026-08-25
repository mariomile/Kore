# tauri-plugin-recording

First-party Tauri 2 plugin providing native audio-memo recording for the
Reflect iOS app: AVAudioRecorder capture, staging of the recorded file for the
app to pick up, the recording Live Activity, and the OS entry-point action
queue (App Intents / widget "record" actions that must survive the app not
running yet).

- Rust surface: `src/` (`commands.rs`, `models.rs`, with `mobile.rs` bridging
  to Swift; `desktop.rs` returns a loud `UnsupportedPlatform` error — desktop
  records through the webview's MediaRecorder instead).
- iOS implementation: `ios/Sources/` (`RecordingPlugin.swift`,
  `RecordingActivityAttributes.swift` for the Live Activity).
- Registered in `apps/desktop/src-tauri` (see its `Cargo.toml` and `lib.rs`);
  the widget/App Intent callers live under
  `apps/desktop/src-tauri/gen/apple/`.
- Permissions live in `permissions/`; built and tested by the Cargo workspace
  (`cargo test -p tauri-plugin-recording`).
