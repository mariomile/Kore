//! iPhone launch hand-off: from the native launch screen to the first web frame
//! without a blank or white frame in between.
//!
//! iOS drops `LaunchScreen.storyboard` as soon as the app's first native frame
//! commits, which is well before the WKWebView has loaded `index.html`. Left
//! alone, that gap shows WKWebView's default opaque white backing (glaring in
//! dark mode), then the page background without the mark, then the mark again
//! once the page's boot splash paints: the "flashes" on launch.
//!
//! [`install`] closes the gap from the native side, before the page loads:
//! - the webview stops painting its own backing (`isOpaque = false`, clear
//!   background), and the view behind it takes the launch screen's
//!   `LaunchBackground` asset color, which follows light/dark by itself;
//! - a copy of the launch screen's own view is laid over the webview, so the
//!   mark never leaves the screen.
//!
//! [`reveal`] cross-fades that cover away once the page has finished loading.
//! By then `index.html`'s boot splash (`src/lib/boot-splash.ts`) has painted
//! the same mark at the same size in the same place, so the fade is invisible
//! and the splash carries on until the first screen is ready. A fallback in
//! `lib.rs` reveals anyway if the load event never arrives, so the cover can
//! never strand the app behind it.

#[cfg(target_os = "ios")]
mod imp {
    use std::cell::RefCell;

    use block2::RcBlock;
    use objc2::rc::Retained;
    use objc2::runtime::{AnyClass, AnyObject, Bool};
    use objc2::{class, msg_send};
    use objc2_foundation::{ns_string, NSRect};

    /// Same 200 ms as the boot splash's own fade in `index.html`.
    const FADE_SECONDS: f64 = 0.2;

    /// UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight.
    const FLEXIBLE_SIZE: usize = (1 << 1) | (1 << 4);

    thread_local! {
        /// The launch-screen copy over the webview. Main thread only: UIKit
        /// objects are created, read and removed there.
        static COVER: RefCell<Option<Retained<AnyObject>>> = const { RefCell::new(None) };
    }

    /// # Safety
    /// `webview` must be the live `WKWebView` Tauri hands to `with_webview`,
    /// and this must run on the main thread.
    pub unsafe fn install(webview: *mut AnyObject) {
        let Some(webview) = webview.as_ref() else {
            return;
        };

        // Let the view behind show through until the page paints.
        let clear: Retained<AnyObject> = msg_send![class!(UIColor), clearColor];
        let _: () = msg_send![webview, setOpaque: false];
        let _: () = msg_send![webview, setBackgroundColor: &*clear];
        let scroll_view: Option<Retained<AnyObject>> = msg_send![webview, scrollView];
        if let Some(scroll_view) = scroll_view {
            let _: () = msg_send![&scroll_view, setBackgroundColor: &*clear];
        }

        let container: Option<Retained<AnyObject>> = msg_send![webview, superview];
        let Some(container) = container else {
            return;
        };
        let background: Option<Retained<AnyObject>> =
            msg_send![class!(UIColor), colorNamed: ns_string!("LaunchBackground")];
        if let Some(background) = background {
            let _: () = msg_send![&container, setBackgroundColor: &*background];
        }

        // The launch screen's own view, so the cover can't drift from it.
        let storyboard: Option<Retained<AnyObject>> = msg_send![
            class!(UIStoryboard),
            storyboardWithName: ns_string!("LaunchScreen"),
            bundle: Option::<&AnyObject>::None
        ];
        let Some(storyboard) = storyboard else {
            return;
        };
        let controller: Option<Retained<AnyObject>> =
            msg_send![&storyboard, instantiateInitialViewController];
        let Some(controller) = controller else {
            return;
        };
        let cover: Option<Retained<AnyObject>> = msg_send![&controller, view];
        let Some(cover) = cover else {
            return;
        };
        let bounds: NSRect = msg_send![&container, bounds];
        let _: () = msg_send![&cover, setFrame: bounds];
        let _: () = msg_send![&cover, setAutoresizingMask: FLEXIBLE_SIZE];
        let _: () = msg_send![&cover, setUserInteractionEnabled: false];
        let _: () = msg_send![&container, addSubview: &*cover];
        COVER.with(|slot| *slot.borrow_mut() = Some(cover));
    }

    /// Main thread only. Idempotent: later calls find no cover.
    pub fn reveal() {
        let Some(cover) = COVER.with(|slot| slot.borrow_mut().take()) else {
            return;
        };
        let animated = cover.clone();
        let animations = RcBlock::new(move || unsafe {
            let _: () = msg_send![&animated, setAlpha: 0.0f64];
        });
        let removed = cover.clone();
        let completion = RcBlock::new(move |_finished: Bool| unsafe {
            let _: () = msg_send![&removed, removeFromSuperview];
        });
        let view_class: &AnyClass = class!(UIView);
        unsafe {
            let _: () = msg_send![
                view_class,
                animateWithDuration: FADE_SECONDS,
                animations: &*animations,
                completion: &*completion
            ];
        }
    }
}

/// Make the main webview see-through and lay the launch screen over it.
/// Call once, from setup, before the page has painted.
#[cfg(target_os = "ios")]
pub fn install<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) {
    let result = window.with_webview(|webview| {
        // SAFETY: `with_webview` runs on the main thread with the live WKWebView.
        unsafe { imp::install(webview.inner().cast()) }
    });
    if let Err(err) = result {
        tracing::warn!(error = %err, "launch cover not installed");
    }
}

/// Fade the launch-screen cover away. Safe to call more than once and from
/// any thread; the work hops to the main thread.
#[cfg(target_os = "ios")]
pub fn reveal<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    if let Err(err) = app.run_on_main_thread(imp::reveal) {
        tracing::warn!(error = %err, "launch cover not revealed");
    }
}
