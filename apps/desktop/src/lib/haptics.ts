import { hapticFeedback, iosHaptic, type HapticPattern, type IosHapticStyle } from '@kore/core'
import { hapticsEnabled } from '@/lib/haptics-preference'
import { isMacosDesktop } from '@/lib/platform'
import { isMobileSurface } from '@/lib/platform-surface'

/**
 * What an interaction means, the one vocabulary every haptic call site picks
 * from. Each platform plays it with its own hardware below, so a call site
 * never knows which phone or trackpad it is on.
 *
 * Restraint is the rule (Apple HIG): a haptic confirms something the finger
 * did, so plain navigation (opening a note, a sheet, a menu) stays silent.
 *
 * - `selection`: a value changed in a picker, segment, tab, or date strip.
 * - `toggle`: a state flipped (a checkbox, a switch, a task completed).
 * - `action`: a button committed its action (send, add, apply, clear).
 * - `lift`: a press took hold (a long-press selected a block, a block lifts
 *   to be dragged, recording started).
 * - `snap`: something being dragged reached a new place, or a pull crossed
 *   its threshold.
 * - `drop`: something being dragged landed.
 * - `success` / `warning` / `error`: an outcome (saved or moved, a delete,
 *   a failure).
 */
export type Haptic =
  | 'selection'
  | 'toggle'
  | 'action'
  | 'lift'
  | 'snap'
  | 'drop'
  | 'success'
  | 'warning'
  | 'error'

/** The iPhone plays every kind, each with the native style that fits it. */
const IOS_STYLE: Record<Haptic, IosHapticStyle> = {
  selection: 'selection',
  toggle: 'light',
  action: 'light',
  lift: 'medium',
  snap: 'selection',
  drop: 'light',
  success: 'success',
  warning: 'warning',
  error: 'error',
}

/**
 * The Mac trackpad only answers gestures. A Force Touch click already is a
 * haptic (the trackpad doesn't move; the Taptic Engine plays the click), so
 * a knock after a click reads as a double click: clicks, flips, and
 * outcomes stay silent, and only drags and failures knock.
 */
const MAC_PATTERN: Record<Haptic, HapticPattern | null> = {
  selection: null,
  toggle: null,
  action: null,
  lift: null,
  snap: 'alignment',
  drop: 'alignment',
  success: null,
  warning: null,
  error: 'generic',
}

let iosBridgeAvailable = true

/**
 * Fire-and-forget haptic feedback for `kind`. Silent when the user turned
 * haptics off in settings, on surfaces without a haptic engine, and never
 * throws: feedback is garnish, a failed knock must never surface as an error.
 */
export function haptic(kind: Haptic): void {
  if (!hapticsEnabled()) {
    return
  }
  if (isMobileSurface()) {
    playIos(IOS_STYLE[kind])
    return
  }
  const pattern = MAC_PATTERN[kind]
  if (isMacosDesktop && pattern !== null && !prefersReducedMotion()) {
    void hapticFeedback(pattern).catch(() => {})
  }
}

/**
 * iOS goes through the keyboard plugin (WKWebView has no
 * `navigator.vibrate`). Where the plugin isn't registered (browser dev) the
 * first rejected invoke logs once and disables further attempts, so taps
 * never pay for a doomed IPC round-trip.
 */
function playIos(style: IosHapticStyle): void {
  if (!iosBridgeAvailable) {
    return
  }
  void iosHaptic(style).catch((err: unknown) => {
    // Re-check the latch: rapid taps can have several invokes in flight
    // before the first rejection lands, and only one should warn.
    if (!iosBridgeAvailable) {
      return
    }
    iosBridgeAvailable = false
    console.warn('haptics unavailable:', err)
  })
}

/**
 * The Mac keeps its trackpad quiet under Reduce Motion: the CSS kill-switch
 * can't reach native feedback, so the gate lives here.
 */
function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    // matchMedia unavailable (tests): treat as no preference.
    return false
  }
}
