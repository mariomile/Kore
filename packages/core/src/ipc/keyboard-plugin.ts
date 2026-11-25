import { definePluginCommand, ignoredResult } from './plugin'

/**
 * Typed bindings for `plugins/tauri-plugin-keyboard`. Only haptics has a JS
 * surface: the keyboard height is derived from `visualViewport` on the web
 * side (decision 0003), and the plugin's remaining keyboard work is native
 * webview tuning with no IPC.
 */

/**
 * The native iOS feedback styles: a selection tick, two impact weights, and
 * the three notification outcomes. Mirrors the plugin's `HapticStyle`.
 */
export type IosHapticStyle = 'selection' | 'light' | 'medium' | 'success' | 'warning' | 'error'

const hapticCommand = definePluginCommand<{ request: { style: IosHapticStyle } }, unknown>(
  'keyboard',
  'haptic',
  ignoredResult,
)

/** Play one iOS haptic style (a no-op wherever there is no haptic engine). */
export async function iosHaptic(style: IosHapticStyle): Promise<void> {
  await hapticCommand({ request: { style } })
}
