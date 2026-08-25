import { isTauri } from '@tauri-apps/api/core'

/**
 * Whether the window draws content under a transparent macOS title bar
 * (`titleBarStyle: "Overlay"` in tauri.conf.json), with the traffic lights
 * floating over the top-left of the webview.
 *
 * True only in the macOS desktop webview: plain-browser dev and other
 * desktop platforms keep their native title bars, and iPadOS — whose user
 * agent masquerades as macOS — is excluded by the touch-point check.
 *
 * This is a *platform* fact, not the current window state. Fullscreen still
 * reports true here (the overlay style is unchanged) even though macOS has
 * hidden the lights — layout that must clear them should go through
 * {@link needsMacosTrafficLightInset} instead. The title-bar *zone* (the
 * top 28px, `h-7`/`pt-7`) still keys off this; it is claimed by
 * `WindowDragRegion`.
 */
export const hasMacosTitleBarOverlay: boolean =
  isTauri() &&
  typeof navigator !== 'undefined' &&
  navigator.userAgent.includes('Macintosh') &&
  navigator.maxTouchPoints === 0

/**
 * Whether chrome should reserve layout space for the overlaid traffic
 * lights (the dedicated 28px band in `WorkspaceContent`).
 *
 * The lights occupy the top-left only while the window is in the ordinary
 * windowed/zoomed state. Native fullscreen hides them (they reappear as a
 * hover overlay, not a layout reservation), so keeping the band would be a
 * blank strip across the window.
 */
export function needsMacosTrafficLightInset(overlay: boolean, isFullscreen: boolean): boolean {
  return overlay && !isFullscreen
}
