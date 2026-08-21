use crate::error::AppResult;

/// Trackpad haptic feedback (macOS only — a silent no-op elsewhere, so the
/// frontend can fire unconditionally). Patterns follow AppKit's taxonomy:
/// `alignment` for snapping into place (a resize landing), `level-change`
/// for a state flip (a toggle), anything else the generic knock.
///
/// AppKit only actually vibrates when the hardware is a Force Touch trackpad
/// and the user's system settings allow it — the call itself is always safe.
#[tauri::command]
pub fn haptic_feedback(app: tauri::AppHandle, pattern: String) -> AppResult<()> {
    #[cfg(target_os = "macos")]
    {
        use crate::error::AppError;
        use objc2_app_kit::{
            NSHapticFeedbackManager, NSHapticFeedbackPattern, NSHapticFeedbackPerformanceTime,
            NSHapticFeedbackPerformer,
        };

        let pattern = match pattern.as_str() {
            "alignment" => NSHapticFeedbackPattern::Alignment,
            "level-change" => NSHapticFeedbackPattern::LevelChange,
            _ => NSHapticFeedbackPattern::Generic,
        };
        // The command runs on Tauri's thread pool; AppKit conventions want
        // UI-adjacent calls on the main thread.
        app.run_on_main_thread(move || {
            NSHapticFeedbackManager::defaultPerformer().performFeedbackPattern_performanceTime(
                pattern,
                NSHapticFeedbackPerformanceTime::Now,
            );
        })
        .map_err(|err| AppError::io(format!("could not reach the main thread: {err}")))?;
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, pattern);
    }
    Ok(())
}
