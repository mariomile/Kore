//! Native macOS Liquid Glass for Kore's webview chrome.
//!
//! The web UI decides which regions are transparent; this module supplies the
//! system material behind them by installing `NSGlassEffectView` below Tauri's
//! content view. The class is looked up at runtime so Kore keeps opening
//! on macOS versions before 26, where the setting simply keeps the ordinary
//! opaque window ground.

use serde_json::{Map, Value};
use tauri::{AppHandle, Runtime};

#[cfg(target_os = "macos")]
const SETTING_KEY: &str = "liquidGlass";

#[cfg(target_os = "macos")]
pub(crate) fn sync_from_settings<R: Runtime>(app: &AppHandle<R>, settings: &Map<String, Value>) {
    use tauri::Manager;

    let enabled = settings
        .get(SETTING_KEY)
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let available = native_glass_available();

    for window in app.webview_windows().into_values() {
        if window.label() == crate::windows::QUICK_CAPTURE_LABEL {
            continue;
        }

        if !available {
            let _ = window.eval("document.documentElement.removeAttribute('data-native-glass')");
            continue;
        }

        let view_address = match window.ns_view() {
            Ok(view) => view as usize,
            Err(error) => {
                tracing::warn!(%error, window = window.label(), "Liquid Glass could not read the native view");
                continue;
            }
        };

        let label = window.label().to_owned();
        if let Err(error) = window.run_on_main_thread(move || {
            // SAFETY: Tauri owns this NSView for the lifetime of the window,
            // and all AppKit hierarchy mutations run on the main thread. The
            // view stays the NSWindow content view; replacing it breaks Tao's
            // resize-event invariant, so the material is only a subview.
            unsafe { set_enabled(view_address, enabled) };
        }) {
            tracing::warn!(%error, window = label, "Liquid Glass could not reach the main thread");
            continue;
        }

        let marker_script = if enabled {
            "document.documentElement.setAttribute('data-native-glass','on')"
        } else {
            "document.documentElement.removeAttribute('data-native-glass')"
        };
        if let Err(error) = window.eval(marker_script) {
            tracing::warn!(%error, window = window.label(), "Liquid Glass could not update the document marker");
        }
    }
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn sync_from_settings<R: Runtime>(_app: &AppHandle<R>, _settings: &Map<String, Value>) {}

#[cfg(target_os = "macos")]
fn native_glass_available() -> bool {
    use objc2::runtime::AnyClass;

    AnyClass::get(c"NSGlassEffectView").is_some()
}

#[cfg(target_os = "macos")]
unsafe fn set_enabled(view_address: usize, enabled: bool) {
    use objc2::{msg_send, runtime::AnyClass, runtime::AnyObject};
    use objc2_foundation::NSRect;

    let Some(glass_class) = AnyClass::get(c"NSGlassEffectView") else {
        return;
    };

    let content_view = view_address as *mut AnyObject;
    let subviews: *mut AnyObject = msg_send![content_view, subviews];
    let count: usize = msg_send![subviews, count];
    let mut installed_glass = std::ptr::null_mut();
    for index in 0..count {
        let subview: *mut AnyObject = msg_send![subviews, objectAtIndex: index];
        let is_glass: bool = msg_send![subview, isKindOfClass: glass_class];
        if is_glass {
            installed_glass = subview;
            break;
        }
    }

    if enabled {
        if !installed_glass.is_null() {
            return;
        }

        let bounds: NSRect = msg_send![content_view, bounds];
        let glass: *mut AnyObject = msg_send![glass_class, alloc];
        let glass: *mut AnyObject = msg_send![glass, initWithFrame: bounds];
        if glass.is_null() {
            return;
        }

        // NSViewWidthSizable | NSViewHeightSizable.
        let autoresizing_mask = 2usize | 16usize;
        let _: () = msg_send![glass, setAutoresizingMask: autoresizing_mask];
        let _: () = msg_send![content_view, addSubview: glass, positioned: -1isize, relativeTo: std::ptr::null::<AnyObject>()];
        // `alloc` is balanced here; the native hierarchy retains the view.
        let _: () = msg_send![glass, release];
        return;
    }

    if !installed_glass.is_null() {
        let _: () = msg_send![installed_glass, removeFromSuperview];
    }
}
