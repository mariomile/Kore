# tauri-plugin-keyboard

First-party Tauri 2 plugin for the small native keyboard/haptics surface the
webview cannot reach on its own.

Today it exposes a single command, `impact_light`: a light impact haptic (the
app's one haptic strength, used for date selection, task controls, and tab
presses). WKWebView has no `navigator.vibrate`, so the iOS side
(`ios/Sources/KeyboardPlugin.swift`) fires the haptic natively; on desktop and
on devices without a haptic engine the command is a no-op.

- Registered in `apps/desktop/src-tauri` (see its `Cargo.toml` and `lib.rs`).
- Permissions live in `permissions/` (Tauri 2 permission grants).
- Built and tested by the Cargo workspace (`cargo test -p tauri-plugin-keyboard`).
