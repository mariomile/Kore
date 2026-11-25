# tauri-plugin-keyboard

First-party Tauri 2 plugin for the small native keyboard/haptics surface the
webview cannot reach on its own.

Today it exposes a single command, `haptic`, which plays one of iOS's native
feedback styles: `selection`, `light`, `medium`, `success`, `warning`,
`error`. Which interaction plays which style is decided in the frontend
(`apps/desktop/src/lib/haptics.ts`). WKWebView has no `navigator.vibrate`, so the iOS side
(`ios/Sources/KeyboardPlugin.swift`) fires the haptic natively; on desktop and
on devices without a haptic engine the command is a no-op.

- Registered in `apps/desktop/src-tauri` (see its `Cargo.toml` and `lib.rs`).
- Permissions live in `permissions/` (Tauri 2 permission grants).
- Built and tested by the Cargo workspace (`cargo test -p tauri-plugin-keyboard`).
