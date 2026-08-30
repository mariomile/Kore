import { hapticFeedback, type HapticPattern } from '@reflect/core'
import { hapticsEnabled } from '@/lib/haptics-preference'
import { isMacosDesktop } from '@/lib/platform'

/**
 * Fire-and-forget trackpad haptics for interactions worth confirming
 * physically: a toggle flipping (`level-change`), a drag snapping into place
 * or hitting its limit (`alignment`), a failure knock (`generic`).
 *
 * Silent when the user has turned haptics off in settings, macOS-only by
 * gate (the Rust side is a no-op elsewhere anyway, this just skips the IPC
 * round-trip), and silent under `prefers-reduced-motion`: the CSS
 * kill-switch can't reach native feedback, so the gate lives here.
 */
export function haptic(pattern: HapticPattern): void {
  if (!hapticsEnabled() || !isMacosDesktop) {
    return
  }
  try {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return
    }
  } catch {
    // matchMedia unavailable (tests): treat as no preference.
  }
  void hapticFeedback(pattern).catch(() => {
    // Feedback is garnish — a failed knock must never surface as an error.
  })
}
